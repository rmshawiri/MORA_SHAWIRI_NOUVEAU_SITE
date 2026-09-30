-- =============================================================================
-- PHASE 4G — COMMERCE : COMMANDES ET PAIEMENTS
--
-- Ce que cette migration ajoute, et dans cet ordre :
--
--   1. deux garde-fous de lecture, comme en 4F ;
--   2. les moyens de paiement, configurables et sans le moindre secret ;
--   3. la commande, ses lignes, et le calcul de ses montants ;
--   4. le paiement, distinct de la commande, et ses justificatifs ;
--   5. le remboursement ;
--   6. l'historique métier — qui n'est pas le journal d'audit ;
--   7. les transitions, fermées côté base ;
--   8. les actes : créer, déclarer, vérifier, rejeter, rembourser, facturer ;
--   9. le bucket privé des justificatifs ;
--  10. les privilèges et la RLS.
--
-- ## Le principe qui commande tout le reste
--
-- Décision D-10, tranchée par le propriétaire : une déclaration de paiement
-- n'est jamais une confirmation. `06_PAIEMENTS.md` § 200 le dit en une phrase
-- — « un paiement n'est considéré comme confirmé que lorsqu'il existe une
-- confirmation réelle et vérifiable » — et § 15 l'applique au cas manuel :
-- « lorsqu'un client indique avoir effectué un paiement manuel, la commande ne
-- doit pas automatiquement passer à Payée ».
--
-- Ce n'est pas une règle d'interface. Elle est portée par le schéma : le statut
-- d'un paiement ne peut atteindre PAYE que par `verify_payment()`, qui exige
-- `payments.verify` ; et le montant soldé d'une commande n'est écrit par
-- personne — il est recalculé par la base à partir des seuls paiements
-- réellement confirmés.
--
-- ## Quatre arbitrages du propriétaire, et ce qu'ils changent ici
--
--   * **Statuts de commande** — la liste de `09_ADMINISTRATION/02` § 22 est
--     retenue contre les deux autres (`05_FONCTIONNALITES/00` § 42 et
--     `07_ARCHITECTURE/01` § 48). Raison : elle est la seule qui ne loge aucun
--     état de paiement dans la commande, ce que § 151 exige en toutes lettres
--     — « les statuts de commande, paiement, prestation, livraison doivent
--     rester séparés ». Les deux autres contiennent « Payée » et
--     « Remboursée », soit deux sources de vérité sur le même fait.
--   * **Compte obligatoire** — `orders.user_id` est `not null`. Le § 161
--     laissait le choix entre trois logiques et interdisait d'en imposer une ;
--     celle-ci a été validée. Elle ne coûte rien aujourd'hui : les quatorze
--     services du catalogue sont tous `commercial_mode = 'quote'` et aucun
--     produit n'existe, donc aucune commande ne naît d'un achat direct.
--   * **Facture** — jamais automatique. `issue_order_invoice()` est un acte
--     administratif explicite et idempotent.
--   * **PayPal** — présent dans `payment_methods`, inactif. Aucun document du
--     projet ne le mentionne, ni Stripe, ni Wakati.
--
-- ## Ce que cette migration ne fait pas
--
-- Aucune commission, aucun clic affilié, aucun taux : la phase 4H s'en charge,
-- et rien ici ne l'empêche de rattacher plus tard une conversion à une commande
-- et à un paiement réels. Aucun espace client : 4I. Aucun moteur de
-- notification : 4J. Aucune passerelle : ni Wakati, ni carte, ni webhook — les
-- colonnes qui permettront d'en brancher une existent, vides.
--
-- Références : plan de développement, phase 4G ; `06_PAIEMENTS.md` en entier ;
-- `09_ADMINISTRATION/02_GESTION_COMMANDES.md` ; `05_FONCTIONNALITES/00` § 42-64 ;
-- `07_ARCHITECTURE_TECHNIQUE/01` § 44-54 ; `07_ARCHITECTURE_TECHNIQUE/05` § 19-38.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. GARDE-FOUS DE LECTURE
--
-- Même forme qu'en 4F : une fonction par domaine, pour que les politiques RLS
-- énoncent une intention plutôt qu'une disjonction recopiée dix fois.
-- -----------------------------------------------------------------------------

create or replace function public.can_view_commandes()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select public.has_permission('orders.view');
$fn$;

comment on function public.can_view_commandes() is
  'Lecture administrative des commandes. Le titulaire d''une commande lit la sienne sans permission.';

create or replace function public.can_view_paiements()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select public.has_permission('payments.view');
$fn$;

comment on function public.can_view_paiements() is
  'Lecture administrative des paiements et de leurs justificatifs.';

revoke execute on function public.can_view_commandes() from public, anon;
revoke execute on function public.can_view_paiements() from public, anon;
grant  execute on function public.can_view_commandes() to authenticated, service_role;
grant  execute on function public.can_view_paiements() to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 2. LES MOYENS DE PAIEMENT
--
-- § 11 : « les moyens de paiement réellement disponibles doivent être
-- configurables. Le site ne doit afficher que les moyens effectivement
-- activés. » Une table, donc, plutôt que sept composants portant chacun un
-- numéro en dur — et le § 19 interdit par ailleurs d'inventer le moindre
-- numéro de compte, ce qui suppose bien un endroit unique où le propriétaire
-- saisit les vrais.
--
-- ## Ce que cette table ne contiendra jamais
--
-- Aucun secret. § 192 : « les secrets de paiement doivent être stockés dans
-- les variables d'environnement ou un gestionnaire de secrets approprié. »
-- Une clé d'API déposée ici serait lisible par toute session capable de lire
-- la liste des moyens actifs — c'est-à-dire par tout client connecté, puisque
-- c'est ainsi qu'il apprend où virer son argent. La contrainte
-- `payment_methods_no_secret` refuse les noms de champs les plus évidents dans
-- les métadonnées ; elle n'est pas une preuve, mais elle attrape l'étourderie.
--
-- ## Les colonnes qui préparent une passerelle sans en construire une
--
-- `processing_mode` distingue MANUEL d'API. Les sept moyens créés ici sont
-- MANUEL, et le resteront tant qu'aucune passerelle n'aura été réellement
-- intégrée. La colonne existe pour que brancher Wakati le jour où son API
-- sortira ne demande pas de refondre les commandes — pas pour laisser croire
-- qu'une automatisation existe.
--
-- `requires_proof` répond au point 10 du cadrage : espèces et chèque se
-- confirment sans justificatif numérique, et forcer le même parcours pour tous
-- les moyens serait une maladresse, pas une rigueur.
-- -----------------------------------------------------------------------------

create table if not exists public.payment_methods (
  code            text primary key,
  label           text not null,
  -- Famille du moyen. Sert à l'affichage et, demain, au rapprochement.
  kind            text not null,
  -- MANUEL : une personne de MORA Shawiri vérifie. API : un fournisseur
  -- confirme côté serveur. Aucun moyen n'est en API aujourd'hui.
  processing_mode text not null default 'MANUEL',
  is_active       boolean not null default false,

  -- Ce que le client lit pour payer. Vide tant que le propriétaire n'a rien
  -- saisi : le § 19 interdit d'inventer une coordonnée.
  instructions    text not null default '',
  account_number  text,
  account_holder  text,

  -- Un reçu est-il attendu du client ? Faux pour les espèces et le chèque.
  requires_proof  boolean not null default true,
  sort_order      integer not null default 0,

  -- Métadonnées techniques NON SENSIBLES. Jamais un secret.
  metadata        jsonb not null default '{}'::jsonb,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.profiles (id) on delete set null,

  constraint payment_methods_code_format check (code ~ '^[A-Z][A-Z0-9_]{1,23}$'),
  constraint payment_methods_label_present
    check (btrim(label) <> '' and length(label) <= 120),
  constraint payment_methods_kind_valid
    check (kind in ('MOBILE_MONEY', 'BANK_TRANSFER', 'CHEQUE', 'CASH', 'ONLINE')),
  constraint payment_methods_mode_valid
    check (processing_mode in ('MANUEL', 'API')),
  constraint payment_methods_instructions_length
    check (length(instructions) <= 2000),
  constraint payment_methods_account_number_length
    check (account_number is null or length(account_number) <= 64),
  constraint payment_methods_account_holder_length
    check (account_holder is null or length(account_holder) <= 120),
  constraint payment_methods_metadata_is_object
    check (jsonb_typeof(metadata) = 'object'),

  -- § 192, dit par le schéma plutôt que par une note d'intention.
  constraint payment_methods_no_secret check (
    not (metadata ?| array[
      'secret', 'api_key', 'apiKey', 'client_secret', 'clientSecret',
      'token', 'access_token', 'private_key', 'privateKey', 'password', 'webhook_secret'
    ])
  ),

  -- Un moyen actif doit savoir dire au client ce qu'il doit faire. Sans quoi
  -- l'interface afficherait une option muette — le § 194 demande d'« afficher
  -- clairement l'indisponibilité » plutôt que de proposer un moyen inutilisable.
  constraint payment_methods_active_is_usable
    check (is_active = false or btrim(instructions) <> '')
);

comment on table public.payment_methods is
  'Moyens de paiement configurables (§ 11). Aucun secret n''y est stocké : le § 192 les réserve aux variables d''environnement.';
comment on column public.payment_methods.processing_mode is
  'MANUEL ou API. Tous MANUEL aujourd''hui. La colonne prépare une passerelle future sans en simuler aucune.';
comment on column public.payment_methods.requires_proof is
  'Faux pour espèces et chèque : leur confirmation est administrative et n''exige aucun justificatif numérique.';
comment on column public.payment_methods.metadata is
  'Métadonnées techniques non sensibles. Une contrainte refuse les clés de secret les plus courantes.';

create index if not exists payment_methods_active_idx
  on public.payment_methods (is_active, sort_order);

drop trigger if exists payment_methods_set_updated_at on public.payment_methods;
create trigger payment_methods_set_updated_at
  before update on public.payment_methods
  for each row execute function public.set_updated_at();


-- Les sept moyens validés par le propriétaire. Les coordonnées viennent de lui
-- et de lui seul ; là où il n'en a pas fourni, la colonne reste nulle et le
-- moyen reste inactif, conformément au § 19.
--
-- `do nothing` et non `do update` : une fois la table créée, c'est
-- l'administration qui fait autorité sur ces lignes. Rejouer la migration ne
-- doit pas écraser un numéro que le propriétaire aurait corrigé.
insert into public.payment_methods
  (code, label, kind, is_active, requires_proof, sort_order,
   account_number, account_holder, instructions)
values
  ('MVOLA', 'Paiement via Mvola', 'MOBILE_MONEY', true, true, 10,
   '430 63 06', 'Mohamed Rachade',
   'Effectuez le paiement au 430 63 06 (Mohamed Rachade), puis indiquez la référence de la transaction et joignez le reçu. MORA Shawiri vérifie le paiement avant de le confirmer.'),

  ('HOLO', 'Paiement via Holo', 'MOBILE_MONEY', true, true, 20,
   '430 63 06', 'Rachade Houmaydat Mohamed',
   'Effectuez le paiement au 430 63 06 (Rachade Houmaydat Mohamed), puis indiquez la référence de la transaction et joignez le reçu. MORA Shawiri vérifie le paiement avant de le confirmer.'),

  -- Wakati n'a pas encore lancé son service. Préparé, jamais proposé.
  ('WAKATI', 'Paiement via Wakati', 'MOBILE_MONEY', false, true, 30,
   '351 63 06', 'Mohamed Rachade',
   'Effectuez le paiement au 351 63 06 (Mohamed Rachade), puis indiquez la référence de la transaction et joignez le reçu. MORA Shawiri vérifie le paiement avant de le confirmer.'),

  -- Coordonnées bancaires non communiquées : rien n'est inventé, le moyen
  -- reste inactif jusqu'à leur saisie en administration.
  ('VIREMENT', 'Virement bancaire', 'BANK_TRANSFER', false, true, 40,
   null, null, ''),

  ('CHEQUE', 'Paiement par chèque', 'CHEQUE', true, false, 50,
   null, 'MORA Shawiri',
   'Établissez le chèque à l''ordre de MORA Shawiri. Le paiement est confirmé par MORA Shawiri après réception et encaissement.'),

  ('ESPECES', 'Paiement en espèces auprès de MORA Shawiri', 'CASH', true, false, 60,
   null, 'MORA Shawiri',
   'Réglez en espèces auprès de MORA Shawiri. La confirmation est enregistrée par l''administration ; aucun justificatif ne vous est demandé.'),

  -- Décision du propriétaire : préparé, inactif. Aucun document du projet ne
  -- prévoit d'intégration PayPal, et une redirection navigateur ne prouve rien.
  ('PAYPAL', 'Paiement via PayPal', 'ONLINE', false, true, 70,
   'morapro.entrepreneur@gmail.com', 'MORA Shawiri', '')
on conflict (code) do nothing;


-- -----------------------------------------------------------------------------
-- 3. LA COMMANDE
--
-- § 44 de l'architecture base de données : « identifiant, utilisateur ou
-- prospect, numéro de commande, statut, montant, devise, mode de paiement,
-- dates ». Le « mode de paiement » n'est pas repris ici, et c'est délibéré :
-- le § 49 veut les paiements séparés, et une commande réglée en deux fois par
-- deux moyens différents rendrait la colonne fausse. Le moyen appartient au
-- paiement.
--
-- ## Les six colonnes de montant, et pourquoi aucune n'est de trop
--
-- § 19 exige que le total final se décompose en sous-total, réductions, frais,
-- taxes le cas échéant, et total. Les taxes ne figurent pas : aucune n'est
-- configurée, et en créer une colonne vide laisserait croire le contraire.
--
-- `paid_amount` et `refunded_amount` ne décrivent pas la commande mais ce que
-- les paiements en disent. **Personne ne les écrit** — ni l'interface, ni une
-- action serveur : un déclencheur les recalcule à partir des seuls paiements
-- confirmés. C'est la traduction mécanique du § 8 (« aucun calcul côté
-- client ») et du § 4 (« aucun paiement fictif ») : il n'existe aucun chemin,
-- même privilégié, pour déclarer une commande soldée sans qu'un paiement l'ait
-- réellement été.
--
-- Tous les montants sont `numeric(12, 2)`. Le § 10 interdit le flottant, et le
-- reste du projet — `quotes.amount`, `services.price_amount` — emploie déjà ce
-- type.
--
-- ## Le statut, et ce qu'il ne dit pas
--
-- `status` décrit l'avancement commercial, rien d'autre. Il ne contient ni
-- « payée » ni « remboursée » : § 151. Ce que le paiement raconte est dans
-- `settlement_status`, également dérivé, également non saisissable.
--
-- ## La référence
--
-- `MORA-CMCL-[SÉRIE][NUMÉRO]`, allouée par le Moteur de Documents de 4D. Le
-- § 5 exige une référence unique et stable pour chaque commande, et le prompt
-- maître § 75 fait de CMCL une pièce officielle à part entière : créer une
-- commande, c'est donc émettre sa commande client. Aucun autre document ne
-- suit automatiquement — ni accusé, ni bon de livraison, ni facture.
-- -----------------------------------------------------------------------------

create table if not exists public.orders (
  id                uuid primary key default gen_random_uuid(),

  -- Référence officielle et pièce CMCL correspondante, attribuées ensemble.
  reference         text not null unique,
  document_id       uuid references public.documents (id) on delete set null,

  -- Décision du propriétaire : toute commande appartient à un compte.
  -- `restrict` plutôt que `set null` — le § 92 interdit de faire disparaître
  -- une donnée comptable, et une commande orpheline en serait une.
  user_id           uuid not null references auth.users (id) on delete restrict,

  -- Continuité avec 4F. `quote_id` est **unique** : c'est là, et nulle part
  -- ailleurs, que se joue l'idempotence de la transformation d'un devis en
  -- commande. Rejouer l'acte ne peut pas créer une seconde commande, quelle
  -- que soit la façon dont il est rejoué.
  lead_id           uuid references public.leads (id) on delete set null,
  quote_id          uuid unique references public.quotes (id) on delete restrict,
  quote_request_id  uuid references public.quote_requests (id) on delete set null,

  -- § 9-10 : instantané du client au moment de la commande. Modifier son
  -- profil demain ne réécrit pas l'historique.
  customer_name     text not null,
  customer_email    text not null,
  customer_phone    text,

  status            text not null default 'NOUVELLE',
  -- Dérivé des paiements confirmés. Jamais saisi.
  settlement_status text not null default 'NON_PAYEE',

  -- § 19, décomposition du total final.
  subtotal_amount   numeric(12, 2) not null default 0,
  discount_amount   numeric(12, 2) not null default 0,
  fees_amount       numeric(12, 2) not null default 0,
  total_amount      numeric(12, 2) not null default 0,
  -- Dérivés. Aucun chemin d'écriture, pas même privilégié.
  paid_amount       numeric(12, 2) not null default 0,
  refunded_amount   numeric(12, 2) not null default 0,
  currency          text not null default 'KMF',

  -- § 7 : « toute commande manuelle doit être clairement identifiée ».
  is_manual         boolean not null default false,

  customer_note     text,
  admin_note        text,
  cancel_reason     text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  confirmed_at      timestamptz,
  cancelled_at      timestamptz,
  closed_at         timestamptz,
  created_by        uuid references public.profiles (id) on delete set null,
  updated_by        uuid references public.profiles (id) on delete set null,

  constraint orders_reference_format
    check (reference ~ '^MORA-CMCL-[A-Z]+[0-9]{4}$'),

  -- Décision du propriétaire : `09_ADMINISTRATION/02` § 22, et elle seule.
  constraint orders_status_valid check (
    status in ('NOUVELLE', 'CONFIRMEE', 'EN_TRAITEMENT', 'EN_ATTENTE_INFO',
               'PRETE', 'TERMINEE', 'ANNULEE')
  ),
  constraint orders_settlement_valid check (
    settlement_status in ('NON_PAYEE', 'PARTIELLE', 'SOLDEE',
                          'PARTIELLEMENT_REMBOURSEE', 'REMBOURSEE')
  ),

  constraint orders_currency_valid check (currency ~ '^[A-Z]{3}$'),
  constraint orders_customer_name_present
    check (btrim(customer_name) <> '' and length(customer_name) <= 120),
  constraint orders_customer_email_normalised
    check (customer_email = lower(btrim(customer_email))),
  constraint orders_customer_email_format
    check (customer_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'),
  constraint orders_customer_phone_length
    check (customer_phone is null or length(customer_phone) <= 40),
  constraint orders_customer_note_length
    check (customer_note is null or length(customer_note) <= 4000),
  constraint orders_admin_note_length
    check (admin_note is null or length(admin_note) <= 4000),
  constraint orders_cancel_reason_length
    check (cancel_reason is null or length(cancel_reason) <= 400),

  -- Aucun montant négatif ne peut entrer, d'où qu'il vienne. C'est le refus
  -- du « prix négatif » et de la « remise forgée » au niveau où il tient.
  constraint orders_amounts_positive check (
    subtotal_amount >= 0 and discount_amount >= 0 and fees_amount >= 0
    and total_amount >= 0 and paid_amount >= 0 and refunded_amount >= 0
  ),
  -- Une remise ne peut pas dépasser ce qu'elle réduit.
  constraint orders_discount_bounded check (discount_amount <= subtotal_amount),
  -- Le total EST la somme de ses parties. Écrit comme contrainte, la règle
  -- vaut pour toute écriture, y compris une requête SQL directe.
  constraint orders_total_coherent
    check (total_amount = subtotal_amount - discount_amount + fees_amount),
  -- On ne rembourse pas plus qu'on n'a encaissé (§ 91).
  constraint orders_refund_bounded check (refunded_amount <= paid_amount),

  -- Un état porte sa date, et une date n'apparaît pas sans son état.
  constraint orders_cancelled_coherent check (
    (status = 'ANNULEE' and cancelled_at is not null)
    or (status <> 'ANNULEE' and cancelled_at is null)
  ),
  constraint orders_closed_coherent check (
    (status = 'TERMINEE' and closed_at is not null)
    or (status <> 'TERMINEE' and closed_at is null)
  ),
  -- Une commande qui a dépassé NOUVELLE a forcément été confirmée un jour.
  constraint orders_confirmed_coherent check (
    status in ('NOUVELLE', 'ANNULEE') or confirmed_at is not null
  )
);

comment on table public.orders is
  'Commande commerciale (09_ADMINISTRATION/02). Le statut décrit l''avancement, jamais le paiement — § 151. Montants encaissés dérivés des seuls paiements confirmés.';
comment on column public.orders.quote_id is
  'Devis à l''origine de la commande. UNIQUE : c''est ce qui rend la transformation devis → commande idempotente.';
comment on column public.orders.settlement_status is
  'État de règlement, recalculé par la base. Aucune session ne l''écrit, et aucune fonction ne l''accepte en paramètre.';
comment on column public.orders.paid_amount is
  'Somme des paiements CONFIRMÉS. Dérivé : une déclaration non vérifiée ne l''augmente pas d''un franc.';
comment on column public.orders.is_manual is
  'Vrai pour une commande saisie en administration (§ 7), afin qu''elle ne se confonde pas avec une commande née d''un devis.';

create index if not exists orders_user_idx    on public.orders (user_id, created_at desc);
create index if not exists orders_status_idx  on public.orders (status, created_at desc);
create index if not exists orders_settle_idx  on public.orders (settlement_status, created_at desc);
create index if not exists orders_lead_idx    on public.orders (lead_id) where lead_id is not null;
create index if not exists orders_created_idx on public.orders (created_at desc);

drop trigger if exists orders_set_updated_at on public.orders;
create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 4. LES LIGNES DE COMMANDE
--
-- § 45 : « les produits ou services d'une commande doivent être représentés
-- par des lignes ». § 11-12 : chaque ligne conserve le produit, sa référence,
-- son nom **au moment de la commande**, la quantité, le prix unitaire, la
-- réduction et le montant.
--
-- ## L'instantané, et ce qu'il n'est pas
--
-- `service_id` et `product_id` pointent vers le catalogue 4E-1 : rien n'est
-- dupliqué, la relation existe, et 4H saura retrouver l'offre vendue. Mais
-- `designation`, `unit_price` et `item_reference` sont des copies figées. Le
-- § 46 et le § 12 l'exigent : « si le prix du produit change plus tard,
-- l'ancienne commande doit conserver le prix réellement appliqué ». La
-- relation sert à savoir *quoi* ; l'instantané, à savoir *à quelles
-- conditions*.
--
-- `on delete set null` sur les deux relations va dans le même sens : une offre
-- retirée du catalogue ne doit pas emporter l'historique de ce qui a été vendu.
--
-- ## Le montant de la ligne n'est pas une donnée d'entrée
--
-- `line_total` est écrasé à chaque écriture par un déclencheur. Ce que le
-- navigateur envoie dans cette colonne n'a aucune importance : il est
-- remplacé. C'est le § 87 (« prix côté serveur ») appliqué à l'endroit où il
-- compte, plutôt qu'une validation d'entrée qu'un appel direct contournerait.
-- -----------------------------------------------------------------------------

create table if not exists public.order_items (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.orders (id) on delete cascade,

  -- Relation au catalogue — jamais une copie de l'offre.
  service_id      uuid references public.services (id) on delete set null,
  product_id      uuid references public.products (id) on delete set null,
  -- Ligne issue d'un devis : le montant négocié fait foi, pas le tarif public.
  quote_id        uuid references public.quotes (id) on delete set null,

  -- Instantané commercial (§ 11-12).
  designation     text not null,
  item_reference  text,
  unit_label      text,

  quantity        numeric(12, 3) not null default 1,
  unit_price      numeric(12, 2) not null,
  discount_amount numeric(12, 2) not null default 0,
  -- Toujours recalculé. Voir `tg_order_items_amount`.
  line_total      numeric(12, 2) not null default 0,

  position        integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint order_items_designation_present
    check (btrim(designation) <> '' and length(designation) <= 300),
  constraint order_items_reference_length
    check (item_reference is null or length(item_reference) <= 120),
  constraint order_items_unit_length
    check (unit_label is null or length(unit_label) <= 40),

  -- « Quantité invalide » et « prix négatif » sont refusés ici, une fois pour
  -- toutes, quel que soit le chemin d'écriture.
  constraint order_items_quantity_positive check (quantity > 0),
  constraint order_items_unit_price_positive check (unit_price >= 0),
  constraint order_items_discount_positive check (discount_amount >= 0),
  constraint order_items_discount_bounded
    check (discount_amount <= round(unit_price * quantity, 2)),
  constraint order_items_total_positive check (line_total >= 0),

  -- Une ligne vend au plus une chose du catalogue. Les deux à la fois n'aurait
  -- aucun sens ; aucune des deux est permis — c'est la ligne libre qu'un
  -- administrateur saisit pour une prestation hors catalogue.
  constraint order_items_target_single
    check (num_nonnulls(service_id, product_id) <= 1)
);

comment on table public.order_items is
  'Lignes de commande (§ 45). Relation au catalogue pour savoir quoi, instantané figé pour savoir à quelles conditions (§ 46).';
comment on column public.order_items.line_total is
  'Recalculé par la base à chaque écriture. La valeur envoyée par un client est systématiquement remplacée (§ 87).';
comment on column public.order_items.quote_id is
  'Ligne issue d''un devis accepté : le montant négocié prime sur le tarif public du catalogue.';

create index if not exists order_items_order_idx   on public.order_items (order_id, position);
create index if not exists order_items_service_idx on public.order_items (service_id) where service_id is not null;
create index if not exists order_items_product_idx on public.order_items (product_id) where product_id is not null;

drop trigger if exists order_items_set_updated_at on public.order_items;
create trigger order_items_set_updated_at
  before update on public.order_items
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 5. LE PAIEMENT
--
-- § 49 : « les paiements doivent être séparés des commandes. Une commande peut
-- avoir plusieurs tentatives de paiement. » § 31 : « une commande et un
-- paiement sont deux éléments distincts. »
--
-- ## Les huit statuts, et d'où ils viennent
--
-- `06_PAIEMENTS.md` § 22, sans retouche. Deux documents proposent une liste ;
-- celui-ci fait autorité par renvoi explicite de `00_COMMERCE_EN_LIGNE.md`
-- § 58 (« les règles détaillées des paiements sont définies dans
-- 05_FONCTIONNALITES/06_PAIEMENTS.md »). Sa liste contient en outre
-- EN_VERIFICATION, que l'autre n'a pas et sans lequel D-10 n'aurait pas de
-- traduction : c'est l'état d'un paiement déclaré mais pas encore vérifié,
-- décrit au § 25 comme réservé « aux paiements manuels nécessitant une
-- vérification ».
--
-- INITIE n'est utilisé par personne aujourd'hui. Le § 24 le réserve au cas où
-- « une tentative de paiement a réellement commencé » — ce qui suppose une
-- passerelle. Il est déclaré parce qu'il appartient à la liste officielle, et
-- laissé vide parce qu'aucune passerelle n'existe.
--
-- ## Les deux références, et pourquoi elles ne se confondent pas
--
-- `transaction_reference` est ce que le **client** recopie : le numéro que
-- Mvola lui a envoyé par SMS. C'est une déclaration, pas une preuve — § 18.
-- `external_reference` est ce qu'un **fournisseur** renverrait côté serveur.
-- Elle est nulle partout, et le restera tant qu'aucune API ne sera intégrée.
-- Les confondre reviendrait à traiter la parole du client comme celle de
-- l'opérateur, ce que tout le § 12 du cadrage interdit.
--
-- ## L'unicité de la référence déclarée
--
-- § 163 et § 174 : la même transaction ne doit pas produire deux paiements.
-- L'index unique porte sur le couple moyen + référence normalisée, ce qui
-- attrape la double soumission, le double clic et le rafraîchissement — y
-- compris quand ils arrivent par trois chemins différents. Les déclarations
-- annulées en sont exclues : une saisie erronée doit pouvoir être refaite.
-- -----------------------------------------------------------------------------

create table if not exists public.payments (
  id                   uuid primary key default gen_random_uuid(),

  -- § 33-34 : un paiement est toujours rattaché à sa commande. `restrict` :
  -- une commande portant un paiement ne s'efface pas (§ 92).
  order_id             uuid not null references public.orders (id) on delete restrict,
  method_code          text not null references public.payment_methods (code)
                         on update cascade on delete restrict,

  amount               numeric(12, 2) not null,
  currency             text not null default 'KMF',
  status               text not null default 'EN_ATTENTE',

  -- MANUEL ou API, recopié du moyen à la création. Figé ensuite : si le moyen
  -- passe un jour en API, les paiements déjà traités à la main gardent
  -- l'histoire de la façon dont ils l'ont été.
  processing_mode      text not null default 'MANUEL',

  -- Déclaré par le client (ou saisi par l'administration pour un règlement
  -- hors ligne, § 104).
  declared_by          uuid references auth.users (id) on delete set null,
  transaction_reference text,
  -- Clé de dédoublonnage. Colonne calculée : aucune application ne peut
  -- oublier de normaliser avant de comparer.
  transaction_key      text generated always as
                         (nullif(upper(btrim(coalesce(transaction_reference, ''))), '')) stored,

  -- Réservé à une future passerelle. Vides aujourd'hui, et rien ne les remplit.
  external_reference   text,
  external_status      text,

  -- § 38 : les trois dates d'un paiement ne racontent pas la même chose.
  declared_at          timestamptz,
  verified_at          timestamptz,
  confirmed_at         timestamptz,
  -- § 107 : qui a confirmé.
  verified_by          uuid references public.profiles (id) on delete set null,

  rejection_reason     text,
  client_note          text,
  admin_note           text,

  -- Métadonnées techniques non sensibles. Jamais un reçu, jamais un message.
  metadata             jsonb not null default '{}'::jsonb,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  -- § 22 de 06_PAIEMENTS, à la lettre.
  constraint payments_status_valid check (
    status in ('EN_ATTENTE', 'INITIE', 'EN_VERIFICATION', 'PAYE',
               'ECHEC', 'ANNULE', 'REMBOURSE', 'PARTIELLEMENT_REMBOURSE')
  ),
  constraint payments_mode_valid check (processing_mode in ('MANUEL', 'API')),
  constraint payments_currency_valid check (currency ~ '^[A-Z]{3}$'),

  -- Un paiement de zéro ou négatif n'est pas un paiement.
  constraint payments_amount_positive check (amount > 0),

  constraint payments_transaction_length
    check (transaction_reference is null or length(btrim(transaction_reference)) between 3 and 120),
  constraint payments_external_reference_length
    check (external_reference is null or length(external_reference) <= 160),
  constraint payments_external_status_length
    check (external_status is null or length(external_status) <= 60),
  constraint payments_rejection_length
    check (rejection_reason is null or length(rejection_reason) <= 400),
  constraint payments_client_note_length
    check (client_note is null or length(client_note) <= 1000),
  constraint payments_admin_note_length
    check (admin_note is null or length(admin_note) <= 1000),
  constraint payments_metadata_is_object
    check (jsonb_typeof(metadata) = 'object'),

  -- Le cœur de D-10, dit par une contrainte plutôt que par une convention :
  -- un paiement confirmé porte forcément la trace de qui l'a confirmé et
  -- quand. Il n'existe aucune façon d'écrire PAYE sans cette trace.
  constraint payments_confirmed_traceable check (
    status <> 'PAYE'
    or (confirmed_at is not null and verified_at is not null)
  ),
  -- Symétriquement, un paiement rejeté porte son motif.
  constraint payments_rejected_explained check (
    status <> 'ECHEC' or rejection_reason is not null
  ),
  -- Un paiement déclaré a une date de déclaration.
  constraint payments_declared_coherent check (
    status = 'EN_ATTENTE' or declared_at is not null
  )
);

comment on table public.payments is
  'Paiement rattaché à une commande (§ 49). Déclaré n''est pas confirmé : seul verify_payment() atteint PAYE, et il exige payments.verify.';
comment on column public.payments.transaction_reference is
  'Référence recopiée par le client depuis son opérateur. Une déclaration, jamais une preuve (§ 18).';
comment on column public.payments.external_reference is
  'Référence renvoyée par un fournisseur côté serveur. Vide : aucune passerelle n''est intégrée.';
comment on column public.payments.transaction_key is
  'Référence normalisée, calculée par la base. Support de l''unicité : la même transaction ne produit pas deux paiements (§ 163).';
comment on column public.payments.verified_by is
  'Administrateur ayant confirmé ou rejeté le paiement (§ 107). Dérivé de la session, jamais reçu du navigateur.';

-- § 163, § 174 : la double soumission ne franchit pas cette ligne.
create unique index if not exists payments_transaction_unique
  on public.payments (method_code, transaction_key)
  where transaction_key is not null and status <> 'ANNULE';

create index if not exists payments_order_idx   on public.payments (order_id, created_at desc);
create index if not exists payments_status_idx  on public.payments (status, created_at desc);
create index if not exists payments_method_idx  on public.payments (method_code, created_at desc);
create index if not exists payments_external_idx on public.payments (external_reference)
  where external_reference is not null;

drop trigger if exists payments_set_updated_at on public.payments;
create trigger payments_set_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 6. LES JUSTIFICATIFS
--
-- § 17 : « le client peut transmettre une preuve de paiement — capture,
-- référence, reçu ». § 18, immédiatement après : « une preuve envoyée par le
-- client ne doit pas automatiquement être considérée comme une confirmation
-- bancaire ». Le fichier ne décide de rien ; il aide une personne à décider.
--
-- ## Le fichier n'est pas dans la table
--
-- Seul son emplacement l'est. Le contenu vit dans un bucket **privé**, créé
-- plus bas — jamais dans `contenus-medias`, qui est public et destiné aux
-- visuels du site. Le § 12 du document Stockage réserve les fichiers privés à
-- un espace non public, et le point 12 du cadrage interdit explicitement de
-- rendre un fichier public « pour simplifier son affichage ».
--
-- ## Le chemin n'est jamais celui que le navigateur propose
--
-- § 26 : « le nom original envoyé par l'utilisateur ne doit pas être utilisé
-- directement comme chemin de stockage. » `original_name` est conservé pour
-- l'affichage et rien d'autre ; `storage_path` est construit par le serveur
-- sous la forme `<order_id>/<payment_id>/<uuid>.<ext>`. Une contrainte impose
-- cette forme : un chemin forgé, un `../`, un nom exotique ne peuvent pas être
-- enregistrés, même par un appel direct.
--
-- ## Le même reçu envoyé deux fois
--
-- `checksum` porte l'empreinte du fichier. L'unicité par paiement fait que
-- renvoyer le même justificatif ne crée pas une seconde ligne — le cas
-- explicitement demandé par le point 34 du cadrage.
-- -----------------------------------------------------------------------------

create table if not exists public.payment_proofs (
  id            uuid primary key default gen_random_uuid(),
  payment_id    uuid not null references public.payments (id) on delete cascade,

  storage_bucket text not null default 'paiements-justificatifs',
  storage_path  text not null unique,

  -- Ce que le client avait nommé son fichier. Pour l'affichage seulement.
  original_name text,
  mime_type     text not null,
  file_size     integer not null,
  -- Empreinte SHA-256 en hexadécimal, calculée côté serveur.
  checksum      text not null,

  uploaded_by   uuid references auth.users (id) on delete set null,
  uploaded_at   timestamptz not null default now(),

  constraint payment_proofs_bucket_is_private
    check (storage_bucket = 'paiements-justificatifs'),

  -- La forme du chemin est imposée, pas espérée. `<uuid>/<uuid>/<uuid>.<ext>`
  -- ne laisse passer ni séparateur en trop, ni remontée de répertoire.
  constraint payment_proofs_path_shape check (
    storage_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|pdf)$'
  ),

  -- Les quatre types dont un reçu a réellement besoin : une capture d'écran de
  -- mobile money, une photo, un PDF de banque. Pas de SVG — § 40 du cadrage,
  -- contenu actif possible. Pas d'archive, pas de document bureautique.
  constraint payment_proofs_mime_allowed
    check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),

  -- 5 Mo. Un reçu d'opérateur pèse quelques dizaines de kilo-octets ; une
  -- photo de smartphone non compressée, deux à trois méga-octets. La limite
  -- laisse de la marge sans ouvrir la porte au dépôt de gros fichiers.
  constraint payment_proofs_size_bounded check (file_size > 0 and file_size <= 5242880),

  constraint payment_proofs_original_name_length
    check (original_name is null or length(original_name) <= 200),
  constraint payment_proofs_checksum_format check (checksum ~ '^[0-9a-f]{64}$'),

  -- Le même fichier ne s'attache pas deux fois au même paiement.
  constraint payment_proofs_unique_per_payment unique (payment_id, checksum)
);

comment on table public.payment_proofs is
  'Justificatifs de paiement. Fichiers dans un bucket PRIVÉ ; aucune URL publique n''existe, et le chemin est imposé par contrainte (§ 26-30).';
comment on column public.payment_proofs.storage_path is
  'Chemin construit par le serveur : <commande>/<paiement>/<uuid>.<ext>. Jamais le nom envoyé par le navigateur.';
comment on column public.payment_proofs.checksum is
  'SHA-256 du fichier. Rend le dépôt idempotent : le même reçu renvoyé ne crée pas une seconde ligne.';

create index if not exists payment_proofs_payment_idx on public.payment_proofs (payment_id, uploaded_at desc);


-- -----------------------------------------------------------------------------
-- 7. LES REMBOURSEMENTS
--
-- § 89-98. Le plan de la phase 4G nomme la table `refunds` et demande le
-- remboursement « total et partiel ».
--
-- Un remboursement est un **acte enregistré**, jamais un acte simulé — § 96 :
-- « Claude Code ne doit jamais simuler un remboursement. » Rien ici ne rend
-- d'argent : la table consigne ce que MORA Shawiri a réellement fait, avec son
-- montant, son moyen, sa date et son auteur. C'est exactement la même logique
-- que la confirmation de paiement, et pour la même raison.
--
-- `amount` est borné par ce qui a été encaissé : la contrainte
-- `orders_refund_bounded` empêche un cumul supérieur au montant payé, et
-- `tg_refunds_bounded` refuse en outre de rembourser un paiement au-delà de ce
-- qu'il portait. § 91 demande de conserver montant initial, montant remboursé
-- et montant restant ; les trois se lisent sans ambiguïté.
-- -----------------------------------------------------------------------------

create table if not exists public.refunds (
  id             uuid primary key default gen_random_uuid(),

  order_id       uuid not null references public.orders (id) on delete restrict,
  -- Le paiement remboursé. Nul lorsque le remboursement ne se rattache pas à
  -- un règlement précis — un geste commercial global, par exemple.
  payment_id     uuid references public.payments (id) on delete restrict,
  -- Avoir client (AVCL) éventuellement émis. Jamais automatique.
  document_id    uuid references public.documents (id) on delete set null,

  amount         numeric(12, 2) not null,
  currency       text not null default 'KMF',
  status         text not null default 'EN_COURS',

  -- Par quel moyen l'argent est reparti. Souvent le même que l'encaissement,
  -- pas nécessairement.
  method_code    text references public.payment_methods (code)
                   on update cascade on delete set null,
  external_reference text,
  reason         text not null,

  requested_at   timestamptz not null default now(),
  completed_at   timestamptz,
  failed_reason  text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references public.profiles (id) on delete set null,
  updated_by     uuid references public.profiles (id) on delete set null,

  constraint refunds_status_valid
    check (status in ('EN_COURS', 'EFFECTUE', 'ECHEC', 'ANNULE')),
  constraint refunds_amount_positive check (amount > 0),
  constraint refunds_currency_valid check (currency ~ '^[A-Z]{3}$'),
  constraint refunds_reason_present
    check (btrim(reason) <> '' and length(reason) <= 400),
  constraint refunds_external_reference_length
    check (external_reference is null or length(external_reference) <= 160),
  constraint refunds_failed_reason_length
    check (failed_reason is null or length(failed_reason) <= 400),

  -- § 98 : « si le remboursement échoue, le système doit conserver l'état réel
  -- de l'opération ». Un échec porte donc son motif, et un remboursement
  -- effectué porte sa date.
  constraint refunds_completed_coherent check (
    (status = 'EFFECTUE' and completed_at is not null)
    or (status <> 'EFFECTUE' and completed_at is null)
  ),
  constraint refunds_failed_explained check (
    status <> 'ECHEC' or failed_reason is not null
  )
);

comment on table public.refunds is
  'Remboursements enregistrés (§ 89-98). Consigne ce qui a réellement été fait ; ne déclenche aucun mouvement d''argent.';
comment on column public.refunds.status is
  'Seul EFFECTUE alimente orders.refunded_amount. Un remboursement en cours ne réduit rien.';

create index if not exists refunds_order_idx   on public.refunds (order_id, created_at desc);
create index if not exists refunds_payment_idx on public.refunds (payment_id) where payment_id is not null;
create index if not exists refunds_status_idx  on public.refunds (status, created_at desc);

drop trigger if exists refunds_set_updated_at on public.refunds;
create trigger refunds_set_updated_at
  before update on public.refunds
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 8. L'HISTORIQUE MÉTIER — QUI N'EST PAS LE JOURNAL D'AUDIT
--
-- Deux tables, parce que les documents décrivent deux besoins distincts.
--
--   * § 40, « historique des statuts » : la suite des états traversés par la
--     commande, lisible d'un coup d'œil. C'est `order_status_history`, le nom
--     que le plan de développement emploie.
--   * § 41, « journal de commande » : ce qui est arrivé à la commande, statuts
--     compris mais pas seulement — un paiement déclaré, une confirmation, un
--     rejet, un remboursement, un document émis. C'est `order_events`.
--
-- Les réunir aurait obligé le journal à porter deux colonnes de statut vides
-- neuf fois sur dix, ou l'historique à filtrer un type d'événement pour
-- retrouver sa propre raison d'être.
--
-- ## Ce qu'on n'y met pas
--
-- Le point 26 du cadrage est explicite, et le § 90 du document commandes le
-- redit : pas de reçu, pas de coordonnées bancaires, pas de message personnel,
-- pas de contenu de justificatif. Un événement dit **ce qui s'est passé** et
-- **sur quel montant**. Le reste se lit dans la commande elle-même, sous les
-- permissions qui la protègent.
--
-- ## Pourquoi la base les écrit, et pas le code appelant
--
-- Même raison qu'en 4F : un historique écrit par l'appelant manque dès qu'un
-- chemin l'oublie — une correction en SQL, un script de reprise. Les
-- déclencheurs l'écrivent quelle que soit la provenance de l'écriture.
--
-- Ni l'une ni l'autre table n'est modifiable : aucune politique UPDATE, aucune
-- politique DELETE, et les privilèges correspondants sont retirés plus bas.
-- -----------------------------------------------------------------------------

create table if not exists public.order_status_history (
  id           bigint generated always as identity primary key,
  order_id     uuid not null references public.orders (id) on delete cascade,
  from_status  text,
  to_status    text not null,
  changed_at   timestamptz not null default now(),
  actor_id     uuid references auth.users (id) on delete set null,
  actor_label  text,
  note         text,

  constraint osh_note_length check (note is null or length(note) <= 400)
);

comment on table public.order_status_history is
  'Suite des statuts traversés par une commande (§ 40). Écrite par la base, jamais modifiable.';

create index if not exists osh_order_idx on public.order_status_history (order_id, changed_at desc);


create table if not exists public.order_events (
  id           bigint generated always as identity primary key,
  order_id     uuid not null references public.orders (id) on delete cascade,
  -- Rattachements facultatifs, pour retrouver l'objet concerné.
  payment_id   uuid references public.payments (id) on delete set null,
  refund_id    uuid references public.refunds (id) on delete set null,

  event_type   text not null,
  -- Phrase courte et factuelle. Ni reçu, ni message du client.
  summary      text not null,
  amount       numeric(12, 2),

  occurred_at  timestamptz not null default now(),
  actor_id     uuid references auth.users (id) on delete set null,
  actor_label  text,

  constraint order_events_type_valid check (
    event_type in (
      'COMMANDE_CREEE',
      'STATUT_CHANGE',
      'MONTANTS_RECALCULES',
      'PAIEMENT_DECLARE',
      'PAIEMENT_CONFIRME',
      'PAIEMENT_REJETE',
      'PAIEMENT_ANNULE',
      'JUSTIFICATIF_AJOUTE',
      'REMBOURSEMENT_ENREGISTRE',
      'REMBOURSEMENT_EFFECTUE',
      'DOCUMENT_EMIS'
    )
  ),
  constraint order_events_summary_present
    check (btrim(summary) <> '' and length(summary) <= 300),
  constraint order_events_amount_positive check (amount is null or amount >= 0)
);

comment on table public.order_events is
  'Journal métier de la commande (§ 41) : créations, statuts, paiements, remboursements, documents. Aucune donnée personnelle au-delà du strict nécessaire.';
comment on column public.order_events.summary is
  'Phrase factuelle. Ne contient ni reçu, ni coordonnées, ni message du client (§ 90).';

create index if not exists order_events_order_idx   on public.order_events (order_id, occurred_at desc);
create index if not exists order_events_payment_idx on public.order_events (payment_id) where payment_id is not null;


-- -----------------------------------------------------------------------------
-- 9. LES MONTANTS SONT CALCULÉS, JAMAIS REÇUS
--
-- Trois déclencheurs, et une seule idée : ce que le navigateur envoie dans une
-- colonne de montant agrégé n'est pas validé, il est **remplacé**. La
-- différence compte. Valider laisse une chance à un chemin oublié ; remplacer
-- n'en laisse aucune, et rend le test « total forgé refusé » vrai par
-- construction plutôt que par vigilance.
--
-- § 8 : « les montants critiques doivent être recalculés et vérifiés côté
-- serveur. Le navigateur ne doit jamais pouvoir imposer le montant final. »
-- § 87 : « prix côté serveur ».
-- -----------------------------------------------------------------------------

create or replace function public.tg_order_items_amount()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  -- Le montant de la ligne n'est pas une donnée d'entrée.
  new.line_total := round(new.unit_price * new.quantity, 2) - new.discount_amount;
  return new;
end;
$fn$;

comment on function public.tg_order_items_amount() is
  'Recalcule le montant d''une ligne à chaque écriture. La valeur reçue est écrasée, jamais lue (§ 87).';

drop trigger if exists order_items_amount on public.order_items;
create trigger order_items_amount
  before insert or update on public.order_items
  for each row execute function public.tg_order_items_amount();


create or replace function public.tg_order_items_rollup()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_order_id uuid := coalesce(new.order_id, old.order_id);
  v_subtotal numeric(12, 2);
  v_discount numeric(12, 2);
begin
  select coalesce(sum(round(oi.unit_price * oi.quantity, 2)), 0),
         coalesce(sum(oi.discount_amount), 0)
    into v_subtotal, v_discount
    from public.order_items oi
   where oi.order_id = v_order_id;

  update public.orders o
     set subtotal_amount = v_subtotal,
         discount_amount = v_discount,
         total_amount    = v_subtotal - v_discount + o.fees_amount
   where o.id = v_order_id
     and (o.subtotal_amount is distinct from v_subtotal
          or o.discount_amount is distinct from v_discount);

  return null;
end;
$fn$;

comment on function public.tg_order_items_rollup() is
  'Reporte le sous-total et les remises des lignes sur la commande. Le total de la commande n''a donc aucune source applicative.';

drop trigger if exists order_items_rollup on public.order_items;
create trigger order_items_rollup
  after insert or update or delete on public.order_items
  for each row execute function public.tg_order_items_rollup();


-- Le règlement d'une commande, recalculé à partir des seuls faits confirmés.
--
-- C'est ici que D-10 devient mécanique : la somme ne retient que les paiements
-- au statut PAYE, REMBOURSE ou PARTIELLEMENT_REMBOURSE — c'est-à-dire ceux
-- qu'une personne autorisée a réellement vérifiés. Un paiement déclaré,
-- initié, en vérification ou rejeté ne compte pour rien, quelle que soit la
-- confiance qu'inspire son justificatif.
create or replace function public.recompute_order_settlement(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_order    public.orders%rowtype;
  v_paid     numeric(12, 2);
  v_refunded numeric(12, 2);
  v_status   text;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then
    return;
  end if;

  select coalesce(sum(p.amount), 0)
    into v_paid
    from public.payments p
   where p.order_id = p_order_id
     and p.status in ('PAYE', 'REMBOURSE', 'PARTIELLEMENT_REMBOURSE');

  select coalesce(sum(r.amount), 0)
    into v_refunded
    from public.refunds r
   where r.order_id = p_order_id
     and r.status = 'EFFECTUE';

  v_status := case
    when v_paid = 0                          then 'NON_PAYEE'
    when v_refunded >= v_paid                then 'REMBOURSEE'
    when v_refunded > 0                      then 'PARTIELLEMENT_REMBOURSEE'
    when v_paid >= v_order.total_amount
         and v_order.total_amount > 0        then 'SOLDEE'
    else 'PARTIELLE'
  end;

  -- Le temps de cette écriture, et d'elle seule, les colonnes dérivées
  -- s'ouvrent. `true` en troisième argument : le réglage ne survit pas à la
  -- transaction, et ne peut donc pas fuir vers une écriture suivante.
  perform set_config('mora.settlement', 'on', true);

  update public.orders
     set paid_amount       = v_paid,
         refunded_amount   = v_refunded,
         settlement_status = v_status
   where id = p_order_id
     and (paid_amount       is distinct from v_paid
          or refunded_amount   is distinct from v_refunded
          or settlement_status is distinct from v_status);

  perform set_config('mora.settlement', 'off', true);
end;
$fn$;

comment on function public.recompute_order_settlement(uuid) is
  'Recalcule le règlement d''une commande à partir des seuls paiements confirmés et remboursements effectués. Unique source de paid_amount.';

revoke execute on function public.recompute_order_settlement(uuid) from public, anon, authenticated;
grant  execute on function public.recompute_order_settlement(uuid) to service_role;


create or replace function public.tg_payments_rollup()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  perform public.recompute_order_settlement(coalesce(new.order_id, old.order_id));
  return null;
end;
$fn$;

drop trigger if exists payments_rollup on public.payments;
create trigger payments_rollup
  after insert or update or delete on public.payments
  for each row execute function public.tg_payments_rollup();

drop trigger if exists refunds_rollup on public.refunds;
create trigger refunds_rollup
  after insert or update or delete on public.refunds
  for each row execute function public.tg_payments_rollup();


-- Les colonnes dérivées ne se laissent pas écrire.
--
-- Le déclencheur de report ci-dessus passe par `recompute_order_settlement`,
-- qui met à jour la commande — il faut donc distinguer cette écriture-là d'une
-- écriture venue d'ailleurs. Le drapeau de session `mora.settlement` sert
-- exactement à cela : posé le temps du recalcul, absent partout ailleurs.
create or replace function public.tg_orders_derived_readonly()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  if coalesce(current_setting('mora.settlement', true), '') = 'on' then
    return new;
  end if;

  if new.paid_amount is distinct from old.paid_amount
     or new.refunded_amount is distinct from old.refunded_amount
     or new.settlement_status is distinct from old.settlement_status then
    raise exception
      'Le règlement d''une commande se déduit des paiements confirmés ; il ne s''écrit pas (D-10).'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$fn$;

comment on function public.tg_orders_derived_readonly() is
  'Refuse toute écriture directe de paid_amount, refunded_amount ou settlement_status. Seul recompute_order_settlement y touche.';

drop trigger if exists orders_derived_readonly on public.orders;
create trigger orders_derived_readonly
  before update on public.orders
  for each row execute function public.tg_orders_derived_readonly();


-- -----------------------------------------------------------------------------
-- 10. LES TRANSITIONS, FERMÉES CÔTÉ BASE
--
-- § 129 : « un client ne doit jamais pouvoir transformer En attente en Payé
-- via une requête manipulée. » § 173 en fait un test. La réponse n'est pas de
-- valider le statut à l'entrée d'une action serveur — un appel direct à
-- PostgREST contournerait l'action — mais de fermer le graphe là où toutes les
-- écritures passent.
--
-- Deux choses sont vérifiées à chaque changement :
--
--   1. **la permission**, qui dépend de la transition demandée et pas
--      seulement de la table. Traiter une commande et l'annuler ne réclament
--      pas le même droit ; confirmer un paiement et le rembourser non plus ;
--   2. **la légalité de la transition**, par un graphe explicite. Ce qui n'y
--      figure pas est refusé, y compris les sauts qui « paraissent »
--      inoffensifs.
--
-- `is_privileged_db_role()` laisse passer le service : les fonctions DEFINER
-- vérifient elles-mêmes leurs permissions, comme en 4F.
-- -----------------------------------------------------------------------------

create or replace function public.tg_orders_transition_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
declare
  v_allowed text[];
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if not public.is_privileged_db_role() then
    -- Annuler n'est pas traiter. § 16 du cadrage range les deux actes parmi
    -- les actes sensibles, et 4A leur a donné deux permissions distinctes.
    if new.status = 'ANNULEE' then
      if not public.has_permission('orders.cancel') then
        raise exception 'Annulation refusée : permission orders.cancel requise.'
          using errcode = '42501';
      end if;
    elsif not public.has_permission('orders.update') then
      raise exception 'Changement de statut refusé : permission orders.update requise.'
        using errcode = '42501';
    end if;
  end if;

  v_allowed := case old.status
    when 'NOUVELLE'        then array['CONFIRMEE', 'ANNULEE']
    when 'CONFIRMEE'       then array['EN_TRAITEMENT', 'EN_ATTENTE_INFO', 'PRETE', 'ANNULEE']
    when 'EN_TRAITEMENT'   then array['EN_ATTENTE_INFO', 'PRETE', 'TERMINEE', 'ANNULEE']
    when 'EN_ATTENTE_INFO' then array['EN_TRAITEMENT', 'PRETE', 'ANNULEE']
    when 'PRETE'           then array['TERMINEE', 'ANNULEE']
    -- § 63-64 : terminée et annulée sont des états finaux. Une commande
    -- annulée « reste accessible dans l'historique », elle ne repart pas.
    else array[]::text[]
  end;

  if not (new.status = any (v_allowed)) then
    raise exception 'Transition refusée : une commande % ne peut pas devenir %.',
      old.status, new.status
      using errcode = 'check_violation';
  end if;

  -- Les dates suivent l'état, sans que l'appelant ait à y penser — et sans
  -- qu'il puisse les contredire.
  if new.status = 'ANNULEE' then
    new.cancelled_at := coalesce(new.cancelled_at, now());
  end if;
  if new.status = 'TERMINEE' then
    new.closed_at := coalesce(new.closed_at, now());
  end if;
  if new.status <> 'NOUVELLE' and new.status <> 'ANNULEE' then
    new.confirmed_at := coalesce(new.confirmed_at, now());
  end if;

  return new;
end;
$fn$;

comment on function public.tg_orders_transition_guard() is
  'Ferme le graphe des statuts de commande et exige orders.cancel pour annuler, orders.update pour le reste.';

drop trigger if exists orders_transition_guard on public.orders;
create trigger orders_transition_guard
  before update on public.orders
  for each row execute function public.tg_orders_transition_guard();


-- La référence d'une commande, et le lien qui la rattache à son devis, ne
-- bougent pas. § 5 : « la référence doit être stable et ne doit jamais être
-- réutilisée ». Rattacher après coup une commande à un autre devis briserait
-- par ailleurs l'idempotence que l'unicité de `quote_id` garantit.
create or replace function public.tg_orders_identity_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  if new.reference is distinct from old.reference
     or new.document_id is distinct from old.document_id
     or new.quote_id is distinct from old.quote_id
     or new.user_id is distinct from old.user_id
     or new.currency is distinct from old.currency
     or new.created_at is distinct from old.created_at then
    raise exception
      'L''identité d''une commande — référence, pièce, devis, titulaire, devise — est immuable (§ 5, § 91).'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$fn$;

comment on function public.tg_orders_identity_immutable() is
  'Gèle référence, pièce CMCL, devis d''origine, titulaire et devise après création (§ 5, § 91).';

drop trigger if exists orders_identity_immutable on public.orders;
create trigger orders_identity_immutable
  before update on public.orders
  for each row execute function public.tg_orders_identity_immutable();


-- Une commande close ne se réécrit pas.
--
-- § 91 : « une commande finalisée doit être considérée comme une donnée
-- historique ; les modifications doivent être limitées et traçables. » Les
-- lignes d'une commande terminée ou annulée sont donc figées — sans quoi
-- changer un prix après coup fausserait aussi bien la comptabilité que les
-- statistiques du § 82.
create or replace function public.tg_order_items_closed_order()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_status text;
begin
  select o.status into v_status
    from public.orders o
   where o.id = coalesce(new.order_id, old.order_id);

  if v_status in ('TERMINEE', 'ANNULEE') then
    raise exception 'Les lignes d''une commande % ne se modifient plus (§ 91).', v_status
      using errcode = 'check_violation';
  end if;

  return coalesce(new, old);
end;
$fn$;

drop trigger if exists order_items_closed_order on public.order_items;
create trigger order_items_closed_order
  before insert or update or delete on public.order_items
  for each row execute function public.tg_order_items_closed_order();


-- -----------------------------------------------------------------------------
-- 11. LES TRANSITIONS DU PAIEMENT
--
-- Le graphe traduit D-10 : aucun chemin ne mène à PAYE sans franchir une
-- vérification, et la permission qui l'autorise — `payments.verify` — est
-- l'une des permissions critiques déclarées en 4A, absente du modèle proposé à
-- la création d'un administrateur. Un administrateur peut donc parfaitement
-- traiter une commande de bout en bout sans pouvoir confirmer un seul franc.
--
-- `verified_by` et les trois dates sont posés ici, depuis la session. § 107 et
-- § 108 les réclament ; les recevoir du navigateur les rendrait déclaratifs.
-- -----------------------------------------------------------------------------

create or replace function public.tg_payments_transition_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
declare
  v_allowed text[];
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if not public.is_privileged_db_role() then
    if new.status in ('PAYE', 'ECHEC') then
      if not public.has_permission('payments.verify') then
        raise exception
          'Vérification refusée : permission payments.verify requise (D-10).'
          using errcode = '42501';
      end if;
    elsif new.status in ('REMBOURSE', 'PARTIELLEMENT_REMBOURSE') then
      if not public.has_permission('payments.refund') then
        raise exception 'Remboursement refusé : permission payments.refund requise.'
          using errcode = '42501';
      end if;
    elsif new.status = 'ANNULE' then
      -- Le déclarant peut retirer sa propre déclaration tant qu'elle n'a pas
      -- été vérifiée. Au-delà, il faut la permission.
      if not (old.status in ('EN_ATTENTE', 'EN_VERIFICATION')
              and old.declared_by is not null
              and old.declared_by = auth.uid())
         and not public.has_permission('payments.verify') then
        raise exception 'Annulation refusée : permission payments.verify requise.'
          using errcode = '42501';
      end if;
    elsif not public.has_permission('payments.verify') then
      raise exception 'Changement de statut refusé : permission payments.verify requise.'
        using errcode = '42501';
    end if;
  end if;

  v_allowed := case old.status
    when 'EN_ATTENTE'      then array['INITIE', 'EN_VERIFICATION', 'ECHEC', 'ANNULE']
    when 'INITIE'          then array['EN_VERIFICATION', 'PAYE', 'ECHEC', 'ANNULE']
    when 'EN_VERIFICATION' then array['PAYE', 'ECHEC', 'ANNULE']
    when 'PAYE'            then array['REMBOURSE', 'PARTIELLEMENT_REMBOURSE']
    when 'PARTIELLEMENT_REMBOURSE' then array['REMBOURSE']
    -- ECHEC, ANNULE, REMBOURSE : terminaux. Une déclaration rejetée ne se
    -- ranime pas ; le client en fait une nouvelle.
    else array[]::text[]
  end;

  if not (new.status = any (v_allowed)) then
    raise exception 'Transition refusée : un paiement % ne peut pas devenir %.',
      old.status, new.status
      using errcode = 'check_violation';
  end if;

  -- § 107-108, posés depuis la session et pas depuis la requête.
  if new.status in ('PAYE', 'ECHEC') then
    new.verified_at := coalesce(new.verified_at, now());
    new.verified_by := coalesce(
      (select p.id from public.profiles p where p.id = auth.uid()),
      new.verified_by
    );
  end if;
  if new.status = 'PAYE' then
    new.confirmed_at := coalesce(new.confirmed_at, now());
  end if;

  return new;
end;
$fn$;

comment on function public.tg_payments_transition_guard() is
  'Ferme le graphe des statuts de paiement. PAYE exige payments.verify ; le remboursement exige payments.refund (D-10).';

drop trigger if exists payments_transition_guard on public.payments;
create trigger payments_transition_guard
  before update on public.payments
  for each row execute function public.tg_payments_transition_guard();


-- § 109 : « les informations critiques d'un paiement ne doivent pas pouvoir
-- être modifiées librement ». Une fois le paiement vérifié, son montant, son
-- moyen, sa commande et sa référence sont des faits. § 110 ajoute qu'un
-- paiement confirmé ne se supprime pas pour corriger une erreur — d'où
-- l'absence de toute politique DELETE plus bas.
create or replace function public.tg_payments_critical_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  if new.order_id is distinct from old.order_id then
    raise exception 'Un paiement ne change pas de commande (§ 33).'
      using errcode = 'check_violation';
  end if;

  if old.status in ('PAYE', 'REMBOURSE', 'PARTIELLEMENT_REMBOURSE', 'ECHEC') then
    if new.amount is distinct from old.amount
       or new.currency is distinct from old.currency
       or new.method_code is distinct from old.method_code
       or new.transaction_reference is distinct from old.transaction_reference
       or new.confirmed_at is distinct from old.confirmed_at
       or new.verified_by is distinct from old.verified_by then
      raise exception
        'Les informations critiques d''un paiement vérifié sont figées (§ 109-111).'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$fn$;

comment on function public.tg_payments_critical_immutable() is
  'Gèle montant, moyen, référence et traces de vérification dès qu''un paiement a été vérifié (§ 109-111).';

drop trigger if exists payments_critical_immutable on public.payments;
create trigger payments_critical_immutable
  before update on public.payments
  for each row execute function public.tg_payments_critical_immutable();


-- Un paiement ne peut pas dépasser ce qui reste dû, ni porter une devise
-- étrangère à sa commande.
--
-- Le cadrage demande de refuser un « montant payé supérieur ou incohérent ».
-- Le § 99 réserve par ailleurs les paiements partiels à une décision
-- commerciale qui n'a pas été prise : plusieurs paiements restent donc
-- possibles — le § 49 l'exige — mais leur somme confirmée ne peut pas excéder
-- le total de la commande.
create or replace function public.tg_payments_amount_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_order     public.orders%rowtype;
  v_confirmed numeric(12, 2);
begin
  select * into v_order from public.orders where id = new.order_id;
  if not found then
    raise exception 'Commande introuvable.' using errcode = 'no_data_found';
  end if;

  if new.currency <> v_order.currency then
    raise exception 'La devise du paiement (%) diffère de celle de la commande (%).',
      new.currency, v_order.currency
      using errcode = 'check_violation';
  end if;

  if v_order.status = 'ANNULEE' then
    raise exception 'Une commande annulée ne reçoit pas de paiement (§ 97).'
      using errcode = 'check_violation';
  end if;

  -- Seuls les montants déjà confirmés bornent le nouveau : une déclaration en
  -- attente n'immobilise rien, sans quoi un client pourrait bloquer sa propre
  -- commande en déclarant un paiement fantaisiste.
  select coalesce(sum(p.amount), 0)
    into v_confirmed
    from public.payments p
   where p.order_id = new.order_id
     and p.id <> new.id
     and p.status in ('PAYE', 'REMBOURSE', 'PARTIELLEMENT_REMBOURSE');

  if new.status in ('PAYE', 'REMBOURSE', 'PARTIELLEMENT_REMBOURSE')
     and v_confirmed + new.amount > v_order.total_amount then
    raise exception
      'Montant incohérent : % confirmé(s) plus % dépasseraient le total de la commande (%).',
      v_confirmed, new.amount, v_order.total_amount
      using errcode = 'check_violation';
  end if;

  return new;
end;
$fn$;

comment on function public.tg_payments_amount_guard() is
  'Refuse une devise étrangère à la commande, un paiement sur commande annulée, et un cumul confirmé supérieur au total dû.';

drop trigger if exists payments_amount_guard on public.payments;
create trigger payments_amount_guard
  before insert or update on public.payments
  for each row execute function public.tg_payments_amount_guard();


-- Un remboursement ne dépasse ni ce qui a été encaissé sur la commande, ni ce
-- que portait le paiement remboursé (§ 91).
create or replace function public.tg_refunds_bounded()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_order   public.orders%rowtype;
  v_others  numeric(12, 2);
  v_payment public.payments%rowtype;
begin
  select * into v_order from public.orders where id = new.order_id;
  if not found then
    raise exception 'Commande introuvable.' using errcode = 'no_data_found';
  end if;

  if new.currency <> v_order.currency then
    raise exception 'La devise du remboursement diffère de celle de la commande.'
      using errcode = 'check_violation';
  end if;

  if new.status = 'EFFECTUE' then
    select coalesce(sum(r.amount), 0)
      into v_others
      from public.refunds r
     where r.order_id = new.order_id
       and r.id <> new.id
       and r.status = 'EFFECTUE';

    if v_others + new.amount > v_order.paid_amount then
      raise exception
        'Remboursement refusé : % déjà remboursé(s) plus % dépasseraient les % encaissé(s).',
        v_others, new.amount, v_order.paid_amount
        using errcode = 'check_violation';
    end if;

    if new.payment_id is not null then
      select * into v_payment from public.payments where id = new.payment_id;

      if v_payment.order_id <> new.order_id then
        raise exception 'Le paiement remboursé n''appartient pas à cette commande.'
          using errcode = 'check_violation';
      end if;

      select coalesce(sum(r.amount), 0)
        into v_others
        from public.refunds r
       where r.payment_id = new.payment_id
         and r.id <> new.id
         and r.status = 'EFFECTUE';

      if v_others + new.amount > v_payment.amount then
        raise exception 'Remboursement refusé : il dépasserait le montant du paiement (%).',
          v_payment.amount
          using errcode = 'check_violation';
      end if;
    end if;
  end if;

  return new;
end;
$fn$;

comment on function public.tg_refunds_bounded() is
  'Borne un remboursement effectué par le montant encaissé sur la commande et, le cas échéant, par celui du paiement remboursé (§ 91).';

drop trigger if exists refunds_bounded on public.refunds;
create trigger refunds_bounded
  before insert or update on public.refunds
  for each row execute function public.tg_refunds_bounded();


-- -----------------------------------------------------------------------------
-- 12. L'HISTORIQUE, ÉCRIT PAR LA BASE
--
-- Comme en 4F : les déclencheurs écrivent, quelle que soit la provenance de
-- l'écriture. Un historique tenu par l'appelant manque au premier chemin qui
-- l'oublie.
-- -----------------------------------------------------------------------------

create or replace function public.tg_orders_history()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if tg_op = 'INSERT' then
    insert into public.order_status_history
      (order_id, to_status, actor_id, actor_label)
    values
      (new.id, new.status, auth.uid(), public.relation_actor_label());

    insert into public.order_events
      (order_id, event_type, summary, amount, actor_id, actor_label)
    values
      (new.id,
       'COMMANDE_CREEE',
       case when new.is_manual
            then 'Commande saisie en administration'
            else 'Commande créée' end,
       new.total_amount,
       auth.uid(), public.relation_actor_label());

    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.order_status_history
      (order_id, from_status, to_status, actor_id, actor_label, note)
    values
      (new.id, old.status, new.status, auth.uid(), public.relation_actor_label(),
       case when new.status = 'ANNULEE' then new.cancel_reason end);

    insert into public.order_events
      (order_id, event_type, summary, actor_id, actor_label)
    values
      (new.id, 'STATUT_CHANGE',
       format('Statut : %s → %s', old.status, new.status),
       auth.uid(), public.relation_actor_label());
  end if;

  -- Un changement de montant sur une commande existante mérite sa trace : le
  -- § 16 du cadrage range « modifier un montant » parmi les actes sensibles.
  if new.total_amount is distinct from old.total_amount then
    insert into public.order_events
      (order_id, event_type, summary, amount, actor_id, actor_label)
    values
      (new.id, 'MONTANTS_RECALCULES',
       format('Total : %s → %s %s', old.total_amount, new.total_amount, new.currency),
       new.total_amount,
       auth.uid(), public.relation_actor_label());
  end if;

  return new;
end;
$fn$;

comment on function public.tg_orders_history() is
  'Écrit l''historique des statuts et le journal métier d''une commande, quelle que soit l''origine de l''écriture.';

drop trigger if exists orders_history on public.orders;
create trigger orders_history
  after insert or update on public.orders
  for each row execute function public.tg_orders_history();


create or replace function public.tg_payments_history()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_method text;
begin
  select pm.label into v_method
    from public.payment_methods pm
   where pm.code = new.method_code;

  if tg_op = 'INSERT' then
    insert into public.order_events
      (order_id, payment_id, event_type, summary, amount, actor_id, actor_label)
    values
      (new.order_id, new.id, 'PAIEMENT_DECLARE',
       format('Paiement déclaré — %s', coalesce(v_method, new.method_code)),
       new.amount, auth.uid(), public.relation_actor_label());
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.order_events
      (order_id, payment_id, event_type, summary, amount, actor_id, actor_label)
    values
      (new.order_id, new.id,
       case new.status
         when 'PAYE'   then 'PAIEMENT_CONFIRME'
         when 'ECHEC'  then 'PAIEMENT_REJETE'
         when 'ANNULE' then 'PAIEMENT_ANNULE'
         else 'PAIEMENT_DECLARE'
       end,
       -- Le motif d'un rejet est une information de gestion, pas une donnée
       -- personnelle : il a sa place ici. Le reçu, lui, n'y entre jamais.
       case new.status
         when 'PAYE'   then format('Paiement confirmé — %s', coalesce(v_method, new.method_code))
         when 'ECHEC'  then format('Déclaration rejetée — %s', left(coalesce(new.rejection_reason, 'sans motif'), 200))
         when 'ANNULE' then 'Déclaration annulée'
         else format('Paiement : %s → %s', old.status, new.status)
       end,
       new.amount, auth.uid(), public.relation_actor_label());
  end if;

  return new;
end;
$fn$;

drop trigger if exists payments_history on public.payments;
create trigger payments_history
  after insert or update on public.payments
  for each row execute function public.tg_payments_history();


create or replace function public.tg_refunds_history()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if tg_op = 'INSERT' then
    insert into public.order_events
      (order_id, payment_id, refund_id, event_type, summary, amount, actor_id, actor_label)
    values
      (new.order_id, new.payment_id, new.id, 'REMBOURSEMENT_ENREGISTRE',
       format('Remboursement enregistré — %s', left(new.reason, 200)),
       new.amount, auth.uid(), public.relation_actor_label());
    return new;
  end if;

  if new.status is distinct from old.status and new.status = 'EFFECTUE' then
    insert into public.order_events
      (order_id, payment_id, refund_id, event_type, summary, amount, actor_id, actor_label)
    values
      (new.order_id, new.payment_id, new.id, 'REMBOURSEMENT_EFFECTUE',
       'Remboursement effectué', new.amount,
       auth.uid(), public.relation_actor_label());
  end if;

  return new;
end;
$fn$;

drop trigger if exists refunds_history on public.refunds;
create trigger refunds_history
  after insert or update on public.refunds
  for each row execute function public.tg_refunds_history();


create or replace function public.tg_payment_proofs_history()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_order uuid;
begin
  select p.order_id into v_order from public.payments p where p.id = new.payment_id;

  insert into public.order_events
    (order_id, payment_id, event_type, summary, actor_id, actor_label)
  values
    (v_order, new.payment_id, 'JUSTIFICATIF_AJOUTE',
     -- Ni le nom du fichier, ni son contenu : seulement le fait.
     'Justificatif joint au paiement',
     auth.uid(), public.relation_actor_label());

  return new;
end;
$fn$;

drop trigger if exists payment_proofs_history on public.payment_proofs;
create trigger payment_proofs_history
  after insert on public.payment_proofs
  for each row execute function public.tg_payment_proofs_history();


-- -----------------------------------------------------------------------------
-- 13. L'AUDIT — MAIGRE PAR CONSTRUCTION
--
-- `record_audit_event()` de 4A, pas un second moteur. Le journal technique ne
-- redit pas le journal métier : il enregistre **qui** a fait **quoi**, et
-- s'arrête là.
--
-- Le point 27 du cadrage veut des métadonnées minimales, et le § 90 du
-- document commandes interdit d'y verser des données sensibles. On y trouve
-- donc la référence de la commande, le statut atteint et le montant — trois
-- informations sans lesquelles la trace ne servirait à rien — et jamais le
-- motif détaillé, le reçu, le message du client ni la référence de
-- transaction, qui identifierait un mouvement bancaire réel.
-- -----------------------------------------------------------------------------

create or replace function public.tg_orders_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if tg_op = 'INSERT' then
    perform public.record_audit_event(
      'commerce.commande.creation', 'order', new.reference, 'SUCCES',
      jsonb_build_object('montant', new.total_amount, 'devise', new.currency,
                         'manuelle', new.is_manual)
    );
    return new;
  end if;

  if new.status is distinct from old.status then
    perform public.record_audit_event(
      case new.status
        when 'ANNULEE'  then 'commerce.commande.annulation'
        when 'TERMINEE' then 'commerce.commande.cloture'
        else 'commerce.commande.statut'
      end,
      'order', new.reference, 'SUCCES',
      jsonb_build_object('de', old.status, 'vers', new.status)
    );
  end if;

  if new.total_amount is distinct from old.total_amount then
    perform public.record_audit_event(
      'commerce.commande.montant', 'order', new.reference, 'SUCCES',
      jsonb_build_object('de', old.total_amount, 'vers', new.total_amount)
    );
  end if;

  return new;
end;
$fn$;

drop trigger if exists orders_audit on public.orders;
create trigger orders_audit
  after insert or update on public.orders
  for each row execute function public.tg_orders_audit();


create or replace function public.tg_payments_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_reference text;
begin
  select o.reference into v_reference from public.orders o where o.id = new.order_id;

  if tg_op = 'INSERT' then
    perform public.record_audit_event(
      'commerce.paiement.declaration', 'payment', v_reference, 'SUCCES',
      -- Le moyen et le montant, pas la référence de transaction : elle
      -- désigne un mouvement bancaire réel et n'a rien à faire dans un
      -- journal consultable sous `audit.view`.
      jsonb_build_object('moyen', new.method_code, 'montant', new.amount)
    );
    return new;
  end if;

  if new.status is distinct from old.status then
    perform public.record_audit_event(
      case new.status
        when 'PAYE'   then 'commerce.paiement.confirmation'
        when 'ECHEC'  then 'commerce.paiement.rejet'
        when 'ANNULE' then 'commerce.paiement.annulation'
        else 'commerce.paiement.statut'
      end,
      'payment', v_reference,
      case when new.status = 'ECHEC' then 'REFUS' else 'SUCCES' end,
      jsonb_build_object('de', old.status, 'vers', new.status,
                         'moyen', new.method_code, 'montant', new.amount)
    );
  end if;

  return new;
end;
$fn$;

drop trigger if exists payments_audit on public.payments;
create trigger payments_audit
  after insert or update on public.payments
  for each row execute function public.tg_payments_audit();


create or replace function public.tg_refunds_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_reference text;
begin
  select o.reference into v_reference from public.orders o where o.id = new.order_id;

  if tg_op = 'INSERT' then
    perform public.record_audit_event(
      'commerce.remboursement.enregistrement', 'refund', v_reference, 'SUCCES',
      jsonb_build_object('montant', new.amount, 'statut', new.status)
    );
  elsif new.status is distinct from old.status then
    perform public.record_audit_event(
      'commerce.remboursement.statut', 'refund', v_reference, 'SUCCES',
      jsonb_build_object('de', old.status, 'vers', new.status, 'montant', new.amount)
    );
  end if;

  return new;
end;
$fn$;

drop trigger if exists refunds_audit on public.refunds;
create trigger refunds_audit
  after insert or update on public.refunds
  for each row execute function public.tg_refunds_audit();


-- La configuration des moyens de paiement est un acte administratif sensible :
-- activer un moyen, c'est le proposer à tous les clients ; changer un numéro,
-- c'est rediriger de l'argent.
create or replace function public.tg_payment_methods_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if tg_op = 'INSERT' then
    perform public.record_audit_event(
      'commerce.moyen.creation', 'payment_method', new.code, 'SUCCES',
      jsonb_build_object('actif', new.is_active)
    );
    return new;
  end if;

  if new.is_active is distinct from old.is_active then
    perform public.record_audit_event(
      case when new.is_active then 'commerce.moyen.activation'
           else 'commerce.moyen.desactivation' end,
      'payment_method', new.code, 'SUCCES', '{}'::jsonb
    );
  end if;

  -- Le nouveau numéro n'entre pas dans le journal — seulement le fait qu'il a
  -- changé. Un journal lisible sous `audit.view` n'est pas l'endroit où
  -- recopier une coordonnée de paiement.
  if new.account_number is distinct from old.account_number
     or new.account_holder is distinct from old.account_holder then
    perform public.record_audit_event(
      'commerce.moyen.coordonnees', 'payment_method', new.code, 'SUCCES', '{}'::jsonb
    );
  end if;

  return new;
end;
$fn$;

drop trigger if exists payment_methods_audit on public.payment_methods;
create trigger payment_methods_audit
  after insert or update on public.payment_methods
  for each row execute function public.tg_payment_methods_audit();


-- L'auteur d'une modification, posé depuis la session.
create or replace function public.tg_commerce_stamp_author()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_profile uuid;
begin
  select p.id into v_profile from public.profiles p where p.id = auth.uid();

  if tg_op = 'INSERT' then
    if to_jsonb(new) ? 'created_by' then
      new.created_by := coalesce(v_profile, new.created_by);
    end if;
  end if;

  new.updated_by := coalesce(v_profile, new.updated_by);
  return new;
end;
$fn$;

comment on function public.tg_commerce_stamp_author() is
  'Impose created_by et updated_by depuis auth.uid(). Une valeur reçue du navigateur est ignorée.';

drop trigger if exists orders_stamp_author on public.orders;
create trigger orders_stamp_author
  before insert or update on public.orders
  for each row execute function public.tg_commerce_stamp_author();

drop trigger if exists refunds_stamp_author on public.refunds;
create trigger refunds_stamp_author
  before insert or update on public.refunds
  for each row execute function public.tg_commerce_stamp_author();

drop trigger if exists payment_methods_stamp_author on public.payment_methods;
create trigger payment_methods_stamp_author
  before insert or update on public.payment_methods
  for each row execute function public.tg_commerce_stamp_author();


-- -----------------------------------------------------------------------------
-- 14. LES ACTES
--
-- Chaque acte sensible est une fonction, pour la même raison qu'en 4F : une
-- opération qui touche plusieurs tables doit réussir ou échouer d'un bloc, et
-- son idempotence doit être garantie par la base plutôt que par la discipline
-- de l'appelant.
--
-- Toutes vérifient leurs permissions elles-mêmes — `security definer` désarme
-- les déclencheurs de transition, qui ne voient qu'un rôle privilégié.
-- -----------------------------------------------------------------------------

-- DEVIS ACCEPTÉ → COMMANDE
--
-- § 29 : « lorsqu'un devis est accepté, le système peut créer une commande
-- associée. La relation entre le devis et la commande doit être conservée. »
-- § 28, juste avant : « une demande de devis ne doit pas être automatiquement
-- considérée comme une commande payée. » La commande naît donc en NOUVELLE,
-- sans le moindre paiement.
--
-- ## L'idempotence n'est pas une précaution, c'est une contrainte
--
-- `orders.quote_id` est unique. Même si cette fonction était appelée dix fois
-- en parallèle, neuf appels échoueraient sur l'index — la fonction préfère
-- donc regarder d'abord, et renvoyer la commande existante plutôt qu'une
-- erreur. Double clic, rafraîchissement, rejeu : un seul résultat possible.
--
-- ## Le devis n'est pas retouché
--
-- Son montant, sa référence et sa date restent ce qu'ils étaient. Le § 91 fait
-- de la commande une donnée historique ; le devis l'était déjà.
create or replace function public.place_order_from_quote(p_quote_id uuid)
returns public.orders
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_quote    public.quotes%rowtype;
  v_request  public.quote_requests%rowtype;
  v_lead     public.leads%rowtype;
  v_existing public.orders%rowtype;
  v_document public.documents%rowtype;
  v_order    public.orders%rowtype;
begin
  if auth.uid() is not null and not public.has_permission('orders.update') then
    raise exception 'Création refusée : permission orders.update requise.'
      using errcode = '42501';
  end if;

  select * into v_quote from public.quotes where id = p_quote_id;
  if not found then
    raise exception 'Devis introuvable.' using errcode = 'no_data_found';
  end if;

  -- Idempotence. Regardée avant tout le reste, et notamment avant la moindre
  -- allocation de numéro : rejouer l'acte ne doit pas consommer un CMCL.
  select * into v_existing from public.orders where quote_id = p_quote_id;
  if found then
    return v_existing;
  end if;

  if v_quote.status <> 'ACCEPTE' then
    raise exception
      'Seul un devis accepté devient une commande (celui-ci est %).', v_quote.status
      using errcode = 'check_violation';
  end if;

  select * into v_request from public.quote_requests where id = v_quote.quote_request_id;
  select * into v_lead    from public.leads          where id = v_request.lead_id;

  -- Décision du propriétaire : toute commande appartient à un compte. Le
  -- demandeur qui n'en a pas doit en créer un ; on ne fabrique pas de compte
  -- à sa place, et le § 31 du document commandes l'interdit expressément
  -- (« sans créer automatiquement un compte sans consentement »).
  if v_request.user_id is null then
    raise exception
      'La demande % n''est rattachée à aucun compte : la commande ne peut pas être créée.',
      v_request.reference
      using errcode = 'check_violation';
  end if;

  -- Le Moteur de Documents de 4D, et lui seul. Aucun second allocateur,
  -- aucun MAX(numero) + 1.
  v_document := public.issue_document(
    'CMCL',
    'order',
    null,
    v_request.user_id,
    v_lead.full_name,
    jsonb_build_object(
      'devis',   v_quote.reference,
      'demande', v_request.reference,
      'montant', v_quote.amount,
      'devise',  v_quote.currency
    )
  );

  insert into public.orders (
    reference, document_id, user_id, lead_id, quote_id, quote_request_id,
    customer_name, customer_email, customer_phone,
    fees_amount, currency, is_manual
  )
  values (
    v_document.reference, v_document.id, v_request.user_id, v_lead.id,
    v_quote.id, v_request.id,
    v_lead.full_name, v_lead.email, v_lead.phone,
    0, v_quote.currency, false
  )
  returning * into v_order;

  -- La pièce désigne enfin son entité. `entity_id` n'est pas gelé par le
  -- déclencheur d'immutabilité de 4D, qui ne protège que l'identifiant.
  update public.documents set entity_id = v_order.id where id = v_document.id;

  -- Une ligne, portant le montant négocié. Le tarif public du catalogue ne
  -- s'applique pas : c'est le devis qui fait foi.
  insert into public.order_items
    (order_id, service_id, quote_id, designation, item_reference,
     quantity, unit_price, position)
  values
    (v_order.id, v_quote.service_id, v_quote.id,
     left(v_quote.summary, 300), v_quote.reference,
     1, v_quote.amount, 0);

  insert into public.order_events
    (order_id, event_type, summary, amount, actor_id, actor_label)
  values
    (v_order.id, 'DOCUMENT_EMIS',
     format('Commande client %s émise depuis le devis %s',
            v_document.reference, v_quote.reference),
     v_quote.amount, auth.uid(), public.relation_actor_label());

  select * into v_order from public.orders where id = v_order.id;
  return v_order;
end;
$fn$;

comment on function public.place_order_from_quote(uuid) is
  'Transforme un devis accepté en commande, une seule fois. Rejouée, elle renvoie la commande existante sans consommer de numéro (§ 29).';

revoke execute on function public.place_order_from_quote(uuid) from public, anon;
grant  execute on function public.place_order_from_quote(uuid) to authenticated, service_role;


-- COMMANDE SAISIE EN ADMINISTRATION
--
-- § 7 : « une commande peut être créée manuellement par un administrateur
-- lorsque cela est nécessaire. Toute commande manuelle doit être clairement
-- identifiée comme telle. »
--
-- ## Les prix ne viennent pas de l'appelant
--
-- Une ligne qui désigne une offre du catalogue reçoit **le prix du
-- catalogue**, relu ici. Ce que la requête proposait dans `unit_price` est
-- ignoré — § 87. Une ligne hors catalogue, elle, porte le prix que
-- l'administrateur saisit : c'est une donnée autorisée, puisqu'il détient
-- `orders.update`.
--
-- ## Une prestation sur devis ne se commande pas au prix zéro
--
-- Point 21 du cadrage. Une offre dont `price_amount` est nul n'a pas de prix
-- public : la commander directement produirait une ligne à zéro franc. La
-- fonction refuse, et renvoie vers le devis — qui est précisément le chemin
-- prévu pour ces quatorze prestations.
create or replace function public.create_manual_order(
  p_user_id uuid,
  p_items   jsonb,
  p_fees    numeric default 0,
  p_note    text default null
)
returns public.orders
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_profile  public.profiles%rowtype;
  v_email    text;
  v_document public.documents%rowtype;
  v_order    public.orders%rowtype;
  v_item     jsonb;
  v_service  public.services%rowtype;
  v_product  public.products%rowtype;
  v_price    numeric(12, 2);
  v_label    text;
  v_ref      text;
  v_qty      numeric(12, 3);
  v_index    integer := 0;
begin
  if auth.uid() is not null and not public.has_permission('orders.update') then
    raise exception 'Création refusée : permission orders.update requise.'
      using errcode = '42501';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Une commande sans ligne n''a pas de sens.'
      using errcode = 'check_violation';
  end if;

  select * into v_profile from public.profiles where id = p_user_id;
  if not found then
    raise exception 'Client introuvable.' using errcode = 'no_data_found';
  end if;

  select u.email into v_email from auth.users u where u.id = p_user_id;
  if v_email is null then
    raise exception 'Le compte client n''a pas d''adresse e-mail.'
      using errcode = 'check_violation';
  end if;

  if coalesce(p_fees, 0) < 0 then
    raise exception 'Des frais négatifs ne sont pas des frais.'
      using errcode = 'check_violation';
  end if;

  v_document := public.issue_document(
    'CMCL', 'order', null, p_user_id,
    coalesce(v_profile.full_name, v_profile.username),
    jsonb_build_object('origine', 'administration')
  );

  insert into public.orders (
    reference, document_id, user_id,
    customer_name, customer_email, customer_phone,
    fees_amount, currency, is_manual, admin_note
  )
  values (
    v_document.reference, v_document.id, p_user_id,
    coalesce(v_profile.full_name, v_profile.username, 'Client'),
    lower(btrim(v_email)), v_profile.phone,
    coalesce(p_fees, 0), 'KMF', true, p_note
  )
  returning * into v_order;

  update public.documents set entity_id = v_order.id where id = v_document.id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((v_item ->> 'quantity')::numeric, 1);

    if v_qty <= 0 then
      raise exception 'Quantité invalide : %.', v_qty using errcode = 'check_violation';
    end if;

    v_service := null;
    v_product := null;
    v_price   := null;

    if (v_item ->> 'service_id') is not null then
      select * into v_service from public.services where id = (v_item ->> 'service_id')::uuid;
      if not found then
        raise exception 'Service introuvable.' using errcode = 'no_data_found';
      end if;
      if v_service.price_amount is null then
        raise exception
          'La prestation « % » est sur devis : elle se commande par un devis accepté, pas au prix zéro.',
          v_service.title
          using errcode = 'check_violation';
      end if;
      -- Le prix du catalogue, relu ici. Pas celui de la requête.
      v_price := v_service.price_amount;
      v_label := v_service.title;
      v_ref   := v_service.slug;

    elsif (v_item ->> 'product_id') is not null then
      select * into v_product from public.products where id = (v_item ->> 'product_id')::uuid;
      if not found then
        raise exception 'Produit introuvable.' using errcode = 'no_data_found';
      end if;
      if v_product.price_amount is null then
        raise exception
          'Le produit « % » n''a pas de prix public : il se commande par un devis accepté.',
          v_product.title
          using errcode = 'check_violation';
      end if;
      v_price := v_product.price_amount;
      v_label := v_product.title;
      v_ref   := v_product.slug;

    else
      -- Ligne hors catalogue, saisie par un administrateur.
      v_price := (v_item ->> 'unit_price')::numeric;
      v_label := btrim(coalesce(v_item ->> 'designation', ''));
      v_ref   := v_item ->> 'item_reference';

      if v_price is null or v_price < 0 then
        raise exception 'Une ligne hors catalogue exige un prix unitaire positif.'
          using errcode = 'check_violation';
      end if;
      if v_label = '' then
        raise exception 'Une ligne hors catalogue exige une désignation.'
          using errcode = 'check_violation';
      end if;
    end if;

    insert into public.order_items
      (order_id, service_id, product_id, designation, item_reference,
       unit_label, quantity, unit_price, discount_amount, position)
    values
      (v_order.id,
       case when v_service.id is not null then v_service.id end,
       case when v_product.id is not null then v_product.id end,
       left(v_label, 300), v_ref,
       v_item ->> 'unit_label',
       v_qty, v_price,
       greatest(coalesce((v_item ->> 'discount_amount')::numeric, 0), 0),
       v_index);

    v_index := v_index + 1;
  end loop;

  select * into v_order from public.orders where id = v_order.id;
  return v_order;
end;
$fn$;

comment on function public.create_manual_order(uuid, jsonb, numeric, text) is
  'Crée une commande depuis l''administration (§ 7). Les prix des lignes du catalogue sont relus en base ; ceux de la requête sont ignorés (§ 87).';

revoke execute on function public.create_manual_order(uuid, jsonb, numeric, text) from public, anon;
grant  execute on function public.create_manual_order(uuid, jsonb, numeric, text) to authenticated, service_role;


-- DÉCLARATION DE PAIEMENT
--
-- Le cœur du parcours client, et le point où D-10 se joue. Le paiement naît
-- en EN_VERIFICATION — § 25 : « ce statut peut être utilisé pour les paiements
-- manuels nécessitant une vérification » — et **jamais** en PAYE.
--
-- ## Ce que l'appelant ne choisit pas
--
-- Ni le titulaire de la commande, ni le statut, ni la date de confirmation,
-- ni l'identité du vérificateur. Le point 17 du cadrage les énumère ; aucun
-- n'est un paramètre de cette fonction, et c'est la façon la plus simple de
-- garantir qu'ils ne seront pas reçus du navigateur.
--
-- ## L'idempotence
--
-- Une même référence de transaction, sur un même moyen, ne produit qu'un
-- paiement : la fonction renvoie l'existant. Sans référence — le cas des
-- espèces — c'est le montant identique déclaré sur la même commande dans les
-- deux minutes qui est considéré comme un double clic.
create or replace function public.declare_payment(
  p_order_id              uuid,
  p_method_code           text,
  p_amount                numeric,
  p_transaction_reference text default null,
  p_client_note           text default null
)
returns public.payments
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_order    public.orders%rowtype;
  v_method   public.payment_methods%rowtype;
  v_key      text;
  v_existing public.payments%rowtype;
  v_payment  public.payments%rowtype;
  v_caller   uuid := auth.uid();
  v_is_admin boolean;
begin
  if v_caller is null then
    raise exception 'Une déclaration de paiement exige une session.'
      using errcode = '42501';
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'Commande introuvable.' using errcode = 'no_data_found';
  end if;

  v_is_admin := public.has_permission('payments.verify');

  -- Le titulaire déclare pour lui-même ; l'administration déclare pour un
  -- règlement hors ligne (§ 104). Personne d'autre, et surtout pas un client
  -- pour la commande d'un autre.
  if v_order.user_id <> v_caller and not v_is_admin then
    raise exception 'Cette commande n''est pas la vôtre.' using errcode = '42501';
  end if;

  select * into v_method from public.payment_methods where code = p_method_code;
  if not found then
    raise exception 'Moyen de paiement inconnu.' using errcode = 'no_data_found';
  end if;

  -- § 11 et § 194 : un moyen désactivé n'est pas proposé, et ne s'utilise pas
  -- davantage par un appel direct. C'est ce qui tient Wakati fermé tant que
  -- son service n'a pas ouvert.
  if not v_method.is_active then
    raise exception 'Le moyen « % » n''est pas disponible.', v_method.label
      using errcode = 'check_violation';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Le montant déclaré doit être positif.' using errcode = 'check_violation';
  end if;

  if v_order.status = 'ANNULEE' then
    raise exception 'Cette commande est annulée.' using errcode = 'check_violation';
  end if;

  v_key := nullif(upper(btrim(coalesce(p_transaction_reference, ''))), '');

  -- § 17 : une référence OU un reçu. Pour les moyens qui l'exigent, la
  -- référence est demandée à la déclaration ; le reçu peut suivre.
  if v_method.requires_proof and v_key is null then
    raise exception
      'Le moyen « % » demande la référence de la transaction.', v_method.label
      using errcode = 'check_violation';
  end if;

  -- Idempotence par référence — § 163, § 174.
  if v_key is not null then
    select * into v_existing
      from public.payments
     where method_code = p_method_code
       and transaction_key = v_key
       and status <> 'ANNULE';

    if found then
      if v_existing.order_id <> p_order_id then
        raise exception
          'Cette référence de transaction est déjà rattachée à une autre commande.'
          using errcode = 'unique_violation';
      end if;
      return v_existing;
    end if;
  else
    -- Espèces et chèque : pas de référence à comparer. Une déclaration
    -- identique dans les deux minutes est un double clic, pas un second
    -- règlement.
    select * into v_existing
      from public.payments
     where order_id = p_order_id
       and method_code = p_method_code
       and amount = p_amount
       and status in ('EN_ATTENTE', 'EN_VERIFICATION')
       and created_at > now() - interval '2 minutes'
     order by created_at desc
     limit 1;

    if found then
      return v_existing;
    end if;
  end if;

  insert into public.payments (
    order_id, method_code, amount, currency, status, processing_mode,
    declared_by, transaction_reference, declared_at, client_note
  )
  values (
    p_order_id, v_method.code, p_amount, v_order.currency,
    -- Déclaré n'est pas confirmé. Jamais.
    'EN_VERIFICATION',
    v_method.processing_mode,
    v_caller, p_transaction_reference, now(),
    left(nullif(btrim(coalesce(p_client_note, '')), ''), 1000)
  )
  returning * into v_payment;

  return v_payment;
end;
$fn$;

comment on function public.declare_payment(uuid, text, numeric, text, text) is
  'Enregistre une déclaration de paiement en EN_VERIFICATION. Idempotente par référence de transaction. N''atteint jamais PAYE (D-10).';

revoke execute on function public.declare_payment(uuid, text, numeric, text, text) from public, anon;
grant  execute on function public.declare_payment(uuid, text, numeric, text, text) to authenticated, service_role;


-- VÉRIFICATION ET REJET
--
-- § 16 : « l'administrateur doit pouvoir vérifier le paiement avant de le
-- considérer comme confirmé. » C'est ici, et nulle part ailleurs, qu'un
-- paiement devient réel. La vérification elle-même est humaine : l'opérateur
-- regarde le reçu, la référence, ou le message reçu sur la ligne — puis
-- appelle cette fonction.
--
-- Confirmer deux fois ne double rien : la fonction sort sans rien faire si le
-- paiement est déjà confirmé.
create or replace function public.verify_payment(
  p_payment_id uuid,
  p_admin_note text default null
)
returns public.payments
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_payment public.payments%rowtype;
begin
  if auth.uid() is not null and not public.has_permission('payments.verify') then
    raise exception 'Confirmation refusée : permission payments.verify requise (D-10).'
      using errcode = '42501';
  end if;

  select * into v_payment from public.payments where id = p_payment_id;
  if not found then
    raise exception 'Paiement introuvable.' using errcode = 'no_data_found';
  end if;

  -- Double confirmation : sans effet, sans erreur. Le point 34 du cadrage
  -- demande qu'une opération répétée ne confirme pas deux fois ; renvoyer
  -- l'état actuel est la façon la plus sûre de le garantir.
  if v_payment.status = 'PAYE' then
    return v_payment;
  end if;

  if v_payment.status not in ('EN_ATTENTE', 'INITIE', 'EN_VERIFICATION') then
    raise exception 'Un paiement % ne se confirme pas.', v_payment.status
      using errcode = 'check_violation';
  end if;

  update public.payments
     set status      = 'PAYE',
         verified_at = now(),
         confirmed_at = now(),
         verified_by = (select p.id from public.profiles p where p.id = auth.uid()),
         admin_note  = coalesce(left(nullif(btrim(coalesce(p_admin_note, '')), ''), 1000), admin_note)
   where id = p_payment_id
  returning * into v_payment;

  return v_payment;
end;
$fn$;

comment on function public.verify_payment(uuid, text) is
  'Confirme un paiement après vérification humaine. Exige payments.verify. Appelée deux fois, elle ne confirme qu''une (D-10).';

revoke execute on function public.verify_payment(uuid, text) from public, anon;
grant  execute on function public.verify_payment(uuid, text) to authenticated, service_role;


create or replace function public.reject_payment(
  p_payment_id uuid,
  p_reason     text
)
returns public.payments
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_payment public.payments%rowtype;
begin
  if auth.uid() is not null and not public.has_permission('payments.verify') then
    raise exception 'Rejet refusé : permission payments.verify requise.'
      using errcode = '42501';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Un rejet sans motif n''apprend rien au client.'
      using errcode = 'check_violation';
  end if;

  select * into v_payment from public.payments where id = p_payment_id;
  if not found then
    raise exception 'Paiement introuvable.' using errcode = 'no_data_found';
  end if;

  if v_payment.status = 'ECHEC' then
    return v_payment;
  end if;

  if v_payment.status not in ('EN_ATTENTE', 'INITIE', 'EN_VERIFICATION') then
    raise exception 'Un paiement % ne se rejette pas.', v_payment.status
      using errcode = 'check_violation';
  end if;

  update public.payments
     set status           = 'ECHEC',
         verified_at      = now(),
         verified_by      = (select p.id from public.profiles p where p.id = auth.uid()),
         rejection_reason = left(btrim(p_reason), 400)
   where id = p_payment_id
  returning * into v_payment;

  return v_payment;
end;
$fn$;

comment on function public.reject_payment(uuid, text) is
  'Rejette une déclaration de paiement, motif obligatoire. Exige payments.verify.';

revoke execute on function public.reject_payment(uuid, text) from public, anon;
grant  execute on function public.reject_payment(uuid, text) to authenticated, service_role;


-- ANNULATION
--
-- § 61-63 : une commande s'annule lorsque les conditions le permettent, avec
-- un motif, et « reste accessible dans l'historique ». § 97 ajoute qu'une
-- commande annulée avant paiement ne génère aucun remboursement — raison pour
-- laquelle cette fonction refuse d'annuler une commande déjà encaissée sans
-- que le remboursement ait été traité.
create or replace function public.cancel_order(
  p_order_id uuid,
  p_reason   text
)
returns public.orders
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_order public.orders%rowtype;
begin
  if auth.uid() is not null and not public.has_permission('orders.cancel') then
    raise exception 'Annulation refusée : permission orders.cancel requise.'
      using errcode = '42501';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Une annulation sans motif n''est pas traçable (§ 62).'
      using errcode = 'check_violation';
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'Commande introuvable.' using errcode = 'no_data_found';
  end if;

  if v_order.status = 'ANNULEE' then
    return v_order;
  end if;

  -- Annuler une commande encaissée sans avoir rendu l'argent laisserait une
  -- incohérence comptable durable. Le remboursement doit précéder.
  if v_order.paid_amount > v_order.refunded_amount then
    raise exception
      'Cette commande a encaissé % et n''en a remboursé que % : traitez le remboursement avant d''annuler.',
      v_order.paid_amount, v_order.refunded_amount
      using errcode = 'check_violation';
  end if;

  update public.orders
     set status        = 'ANNULEE',
         cancel_reason = left(btrim(p_reason), 400),
         cancelled_at  = now()
   where id = p_order_id
  returning * into v_order;

  -- Les déclarations encore en attente n'ont plus d'objet.
  update public.payments
     set status = 'ANNULE'
   where order_id = p_order_id
     and status in ('EN_ATTENTE', 'INITIE', 'EN_VERIFICATION');

  return v_order;
end;
$fn$;

comment on function public.cancel_order(uuid, text) is
  'Annule une commande avec motif (§ 61-62). Refuse tant qu''un encaissement n''a pas été remboursé. Exige orders.cancel.';

revoke execute on function public.cancel_order(uuid, text) from public, anon;
grant  execute on function public.cancel_order(uuid, text) to authenticated, service_role;


-- REMBOURSEMENT
--
-- Deux temps, parce que la réalité en a deux : on décide de rembourser, puis
-- on rembourse. `record_refund` consigne la décision ; `complete_refund`
-- constate que l'argent est parti. Seul le second alimente
-- `orders.refunded_amount`.
--
-- § 96 : rien n'est simulé. Ces fonctions n'émettent aucun virement ; elles
-- enregistrent ce que MORA Shawiri a fait.
create or replace function public.record_refund(
  p_order_id    uuid,
  p_amount      numeric,
  p_reason      text,
  p_payment_id  uuid default null,
  p_method_code text default null
)
returns public.refunds
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_order  public.orders%rowtype;
  v_refund public.refunds%rowtype;
begin
  if auth.uid() is not null
     and not public.has_permission('payments.refund')
     and not public.has_permission('orders.refund') then
    raise exception
      'Remboursement refusé : permission payments.refund ou orders.refund requise.'
      using errcode = '42501';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Un remboursement sans motif n''est pas traçable.'
      using errcode = 'check_violation';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Le montant remboursé doit être positif.'
      using errcode = 'check_violation';
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'Commande introuvable.' using errcode = 'no_data_found';
  end if;

  -- § 97 : pas de remboursement sans encaissement.
  if v_order.paid_amount <= 0 then
    raise exception 'Cette commande n''a rien encaissé : il n''y a rien à rembourser (§ 97).'
      using errcode = 'check_violation';
  end if;

  insert into public.refunds
    (order_id, payment_id, amount, currency, status, method_code, reason)
  values
    (p_order_id, p_payment_id, p_amount, v_order.currency, 'EN_COURS',
     p_method_code, left(btrim(p_reason), 400))
  returning * into v_refund;

  return v_refund;
end;
$fn$;

comment on function public.record_refund(uuid, numeric, text, uuid, text) is
  'Enregistre une décision de remboursement, en cours. N''affecte pas encore le montant remboursé de la commande.';

revoke execute on function public.record_refund(uuid, numeric, text, uuid, text) from public, anon;
grant  execute on function public.record_refund(uuid, numeric, text, uuid, text) to authenticated, service_role;


create or replace function public.complete_refund(
  p_refund_id          uuid,
  p_external_reference text default null
)
returns public.refunds
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_refund  public.refunds%rowtype;
  v_payment public.payments%rowtype;
  v_done    numeric(12, 2);
begin
  if auth.uid() is not null
     and not public.has_permission('payments.refund')
     and not public.has_permission('orders.refund') then
    raise exception 'Remboursement refusé : permission payments.refund requise.'
      using errcode = '42501';
  end if;

  select * into v_refund from public.refunds where id = p_refund_id;
  if not found then
    raise exception 'Remboursement introuvable.' using errcode = 'no_data_found';
  end if;

  -- Idempotence : constater deux fois ne rembourse pas deux fois.
  if v_refund.status = 'EFFECTUE' then
    return v_refund;
  end if;

  if v_refund.status <> 'EN_COURS' then
    raise exception 'Un remboursement % ne se constate pas.', v_refund.status
      using errcode = 'check_violation';
  end if;

  update public.refunds
     set status             = 'EFFECTUE',
         completed_at       = now(),
         external_reference = coalesce(p_external_reference, external_reference)
   where id = p_refund_id
  returning * into v_refund;

  -- § 94 : le paiement remboursé change d'état selon qu'il l'a été en tout ou
  -- en partie. Le calcul se fait sur les remboursements réellement effectués.
  if v_refund.payment_id is not null then
    select * into v_payment from public.payments where id = v_refund.payment_id;

    select coalesce(sum(r.amount), 0)
      into v_done
      from public.refunds r
     where r.payment_id = v_refund.payment_id and r.status = 'EFFECTUE';

    if v_payment.status in ('PAYE', 'PARTIELLEMENT_REMBOURSE') then
      update public.payments
         set status = case when v_done >= v_payment.amount
                           then 'REMBOURSE'
                           else 'PARTIELLEMENT_REMBOURSE' end
       where id = v_refund.payment_id;
    end if;
  end if;

  return v_refund;
end;
$fn$;

comment on function public.complete_refund(uuid, text) is
  'Constate qu''un remboursement a réellement eu lieu (§ 94). Seul acte qui alimente orders.refunded_amount. Idempotent.';

revoke execute on function public.complete_refund(uuid, text) from public, anon;
grant  execute on function public.complete_refund(uuid, text) to authenticated, service_role;


-- FACTURE
--
-- Décision du propriétaire : jamais automatique. Un administrateur l'émet
-- depuis la commande, une fois, et le lien vers la pièce est conservé.
--
-- § 64 : « une facture ne doit pas être marquée comme payée simplement parce
-- qu'elle a été créée. » Cette fonction n'écrit donc rien sur le paiement :
-- elle émet une pièce, et c'est tout. L'état du règlement se lit, comme
-- toujours, dans les paiements confirmés.
--
-- ## L'idempotence, sur une suite comptable
--
-- Émettre deux fois consommerait deux numéros FACL et produirait deux
-- factures pour une même vente. La fonction regarde d'abord si la commande
-- porte déjà une facture ; le cas échéant, elle la renvoie **sans allouer
-- quoi que ce soit**. Le point 40 du cadrage est catégorique sur ce point :
-- les suites officielles ne se percent pas.
create or replace function public.issue_order_invoice(p_order_id uuid)
returns public.documents
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_order    public.orders%rowtype;
  v_existing public.documents%rowtype;
  v_document public.documents%rowtype;
begin
  if auth.uid() is not null and not public.has_permission('orders.update') then
    raise exception 'Émission refusée : permission orders.update requise.'
      using errcode = '42501';
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'Commande introuvable.' using errcode = 'no_data_found';
  end if;

  -- Idempotence, regardée avant toute allocation.
  select * into v_existing
    from public.documents
   where doc_type = 'FACL'
     and entity_type = 'order'
     and entity_id = p_order_id
     and status = 'EMIS'
   order by issued_at
   limit 1;

  if found then
    return v_existing;
  end if;

  -- § 62 : « une facture doit être liée à une commande réelle. » Une commande
  -- annulée n'en est plus une.
  if v_order.status = 'ANNULEE' then
    raise exception 'Une commande annulée ne se facture pas.'
      using errcode = 'check_violation';
  end if;

  if v_order.total_amount <= 0 then
    raise exception 'Une commande sans montant ne se facture pas.'
      using errcode = 'check_violation';
  end if;

  v_document := public.issue_document(
    'FACL', 'order', v_order.id, v_order.user_id, v_order.customer_name,
    jsonb_build_object(
      'commande', v_order.reference,
      'montant',  v_order.total_amount,
      'devise',   v_order.currency
    )
  );

  insert into public.order_events
    (order_id, event_type, summary, amount, actor_id, actor_label)
  values
    (v_order.id, 'DOCUMENT_EMIS',
     format('Facture %s émise', v_document.reference),
     v_order.total_amount, auth.uid(), public.relation_actor_label());

  return v_document;
end;
$fn$;

comment on function public.issue_order_invoice(uuid) is
  'Émet la facture d''une commande, sur acte administratif explicite. Appelée deux fois, elle renvoie la première sans consommer de numéro.';

revoke execute on function public.issue_order_invoice(uuid) from public, anon;
grant  execute on function public.issue_order_invoice(uuid) to authenticated, service_role;


-- JUSTIFICATIF
--
-- L'enregistrement suit le téléversement ; le fichier est déjà dans le bucket
-- privé quand cette fonction est appelée. Elle vérifie ce que le bucket ne
-- peut pas vérifier seul : que le chemin correspond bien au paiement annoncé,
-- et que celui-ci appartient à l'appelant.
--
-- § 22 du document Stockage : « avant de fournir un fichier protégé, le
-- serveur doit vérifier utilisateur, commande, paiement ». La même vérité
-- vaut à l'écriture.
create or replace function public.attach_payment_proof(
  p_payment_id    uuid,
  p_storage_path  text,
  p_mime_type     text,
  p_file_size     integer,
  p_checksum      text,
  p_original_name text default null
)
returns public.payment_proofs
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_payment  public.payments%rowtype;
  v_order    public.orders%rowtype;
  v_existing public.payment_proofs%rowtype;
  v_proof    public.payment_proofs%rowtype;
  v_caller   uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'Le dépôt d''un justificatif exige une session.'
      using errcode = '42501';
  end if;

  select * into v_payment from public.payments where id = p_payment_id;
  if not found then
    raise exception 'Paiement introuvable.' using errcode = 'no_data_found';
  end if;

  select * into v_order from public.orders where id = v_payment.order_id;

  -- Le titulaire de la commande, ou l'administration. Pas un tiers.
  if v_order.user_id <> v_caller and not public.has_permission('payments.verify') then
    raise exception 'Ce paiement n''est pas le vôtre.' using errcode = '42501';
  end if;

  -- Le chemin doit désigner ce paiement-ci. Un chemin pointant vers le dossier
  -- d'un autre client serait rejeté ici avant même la politique Storage.
  if p_storage_path <> format('%s/%s/%s',
                              v_order.id,
                              v_payment.id,
                              split_part(p_storage_path, '/', 3)) then
    raise exception 'Chemin de justificatif incohérent avec le paiement.'
      using errcode = 'check_violation';
  end if;

  -- Le même reçu deux fois : on renvoie le premier.
  select * into v_existing
    from public.payment_proofs
   where payment_id = p_payment_id and checksum = p_checksum;

  if found then
    return v_existing;
  end if;

  insert into public.payment_proofs
    (payment_id, storage_path, original_name, mime_type, file_size, checksum, uploaded_by)
  values
    (p_payment_id, p_storage_path,
     left(nullif(btrim(coalesce(p_original_name, '')), ''), 200),
     p_mime_type, p_file_size, lower(p_checksum), v_caller)
  returning * into v_proof;

  return v_proof;
end;
$fn$;

comment on function public.attach_payment_proof(uuid, text, text, integer, text, text) is
  'Rattache un justificatif déjà téléversé au paiement. Vérifie la propriété et la cohérence du chemin ; idempotente sur l''empreinte du fichier.';

revoke execute on function public.attach_payment_proof(uuid, text, text, integer, text, text) from public, anon;
grant  execute on function public.attach_payment_proof(uuid, text, text, integer, text, text) to authenticated, service_role;


-- Les moyens de paiement réellement proposables à un client.
--
-- § 11 : « le site ne doit afficher que les moyens effectivement activés. »
-- Une fonction plutôt qu'une lecture directe, pour que la règle soit dite une
-- fois — et pour que Wakati reste invisible tant qu'il est inactif, quelle que
-- soit la page qui interroge.
create or replace function public.active_payment_methods()
returns table (
  code           text,
  label          text,
  kind           text,
  instructions   text,
  account_number text,
  account_holder text,
  requires_proof boolean,
  sort_order     integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select pm.code, pm.label, pm.kind, pm.instructions,
         pm.account_number, pm.account_holder, pm.requires_proof, pm.sort_order
    from public.payment_methods pm
   where pm.is_active
   order by pm.sort_order, pm.code;
$fn$;

comment on function public.active_payment_methods() is
  'Moyens réellement activés, dans l''ordre d''affichage. Un moyen inactif n''en sort jamais (§ 11, § 194).';

revoke execute on function public.active_payment_methods() from public, anon;
grant  execute on function public.active_payment_methods() to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 15. LE BUCKET PRIVÉ DES JUSTIFICATIFS
--
-- Un second bucket, et non celui de 4E-2. `contenus-medias` est **public** :
-- il porte les visuels du site, que tout le monde doit voir. Y déposer un reçu
-- bancaire le rendrait lisible de quiconque devine son adresse, ce que le § 23
-- du document Stockage interdit expressément — « connaître l'URL d'un fichier
-- ne doit pas suffire à obtenir un fichier privé ».
--
-- ## Les contrôles sont sur le bucket, pas seulement dans le formulaire
--
-- Comme en 4E-2 : `file_size_limit` et `allowed_mime_types` sont portés par le
-- bucket. Un téléversement qui contournerait l'interface — appel direct à
-- l'API Storage avec un jeton de session valide — se heurte quand même au
-- refus. Le § 35 le demande explicitement.
--
-- Pas de SVG : § 40 du cadrage, contenu actif possible. Pas d'archive, pas de
-- document bureautique. Quatre types, ceux dont un reçu a réellement besoin.
--
-- ## Le chemin porte l'autorisation
--
-- `<commande>/<paiement>/<uuid>.<ext>`. Le premier segment est l'identifiant
-- de la commande, et c'est lui que les politiques interrogent : un client lit
-- un objet si et seulement si la commande nommée par le chemin lui appartient.
-- Deviner l'adresse ne sert donc à rien — il faudrait deviner un UUID **et**
-- être le titulaire de la commande qu'il désigne.
--
-- Aucune politique de suppression, aucune de mise à jour : § 111, « les
-- informations essentielles d'une transaction doivent rester traçables ». Un
-- justificatif versé au dossier y reste.
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'paiements-justificatifs',
  'paiements-justificatifs',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;


-- Lecture : le titulaire de la commande, ou l'administration qui doit vérifier.
-- Personne d'autre — ni un affilié, ni un administrateur sans `payments.view`.
drop policy if exists justificatifs_read on storage.objects;
create policy justificatifs_read
  on storage.objects for select to authenticated
  using (
    bucket_id = 'paiements-justificatifs'
    and (
      public.can_view_paiements()
      or exists (
        select 1 from public.orders o
         where o.id::text = (storage.foldername(name))[1]
           and o.user_id = auth.uid()
      )
    )
  );

-- Dépôt : le titulaire, pour sa propre commande ; ou l'administration, pour un
-- justificatif qu'elle verse elle-même au dossier (point 10 du cadrage).
drop policy if exists justificatifs_insert on storage.objects;
create policy justificatifs_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'paiements-justificatifs'
    and (
      public.has_permission('payments.verify')
      or exists (
        select 1 from public.orders o
         where o.id::text = (storage.foldername(name))[1]
           and o.user_id = auth.uid()
           and o.status <> 'ANNULEE'
      )
    )
  );

-- Ni UPDATE ni DELETE, volontairement : un justificatif ne se remplace pas et
-- ne s'efface pas (§ 111). Une erreur se corrige en en versant un autre.


-- -----------------------------------------------------------------------------
-- 16. PRIVILÈGES DE TABLE
--
-- Supabase accorde d'office tous les privilèges aux rôles applicatifs sur les
-- nouvelles tables de `public`. On les retire, puis on rend exactement ce qui
-- est nécessaire. La RLS filtre les lignes ; les privilèges décident si le
-- verbe est seulement prononçable.
--
-- Rien n'est accordé à `anon` : une commande appartient à un compte.
-- -----------------------------------------------------------------------------

revoke all on public.payment_methods      from anon, authenticated;
revoke all on public.orders               from anon, authenticated;
revoke all on public.order_items          from anon, authenticated;
revoke all on public.payments             from anon, authenticated;
revoke all on public.payment_proofs       from anon, authenticated;
revoke all on public.refunds              from anon, authenticated;
revoke all on public.order_status_history from anon, authenticated;
revoke all on public.order_events         from anon, authenticated;

-- Lecture seule pour tout le monde côté application : les écritures passent
-- par les fonctions, sauf les quelques mises à jour administratives ci-dessous.
grant select on public.payment_methods      to authenticated;
grant select on public.orders               to authenticated;
grant select on public.order_items          to authenticated;
grant select on public.payments             to authenticated;
grant select on public.payment_proofs       to authenticated;
grant select on public.refunds              to authenticated;
grant select on public.order_status_history to authenticated;
grant select on public.order_events         to authenticated;

-- Ce qu'une session administrative modifie directement : le statut et les
-- notes d'une commande, la configuration des moyens. Le reste — créer une
-- commande, confirmer un paiement, rembourser, facturer — reste derrière une
-- fonction, parce que ces actes touchent plusieurs tables à la fois.
grant update on public.orders          to authenticated;
grant update on public.payment_methods to authenticated;
grant insert on public.order_items     to authenticated;
grant update on public.order_items     to authenticated;
grant delete on public.order_items     to authenticated;

-- Historique et journal : lecture seule pour tous, sans exception. Les
-- déclencheurs écrivent en tant que propriétaire des fonctions.
-- Aucun `grant insert`, aucun `grant update`, aucun `grant delete`.


-- -----------------------------------------------------------------------------
-- 17. ROW LEVEL SECURITY
--
-- Deux règles, répétées sur chaque table :
--
--   * un client voit ce qui lui appartient, et rien d'autre. Le § 69 le dit
--     pour les paiements, le § 163 du document commerce pour les commandes ;
--   * un administrateur voit tout **s'il a la permission**, jamais parce qu'il
--     est administrateur. C'est la règle de 4C, et elle ne souffre pas
--     d'exception ici : `admin.full_access` mis à part, un compte ADMIN sans
--     `orders.view` ne lit pas une commande.
--
-- L'appartenance se juge toujours sur `user_id`, jamais sur l'adresse e-mail
-- de la commande : deux comptes peuvent partager une adresse au fil du temps,
-- et une commande n'a qu'un titulaire.
-- -----------------------------------------------------------------------------

alter table public.payment_methods      enable row level security;
alter table public.orders               enable row level security;
alter table public.order_items          enable row level security;
alter table public.payments             enable row level security;
alter table public.payment_proofs       enable row level security;
alter table public.refunds              enable row level security;
alter table public.order_status_history enable row level security;
alter table public.order_events         enable row level security;

/* ----------------------------- payment_methods ---------------------------- */

-- Un client connecté doit savoir où payer : il lit les moyens actifs, et eux
-- seuls. Un moyen désactivé — Wakati, le virement tant que ses coordonnées
-- manquent — n'apparaît pas, et le § 194 est ainsi respecté sans que
-- l'interface ait à y penser.
drop policy if exists payment_methods_select_active on public.payment_methods;
create policy payment_methods_select_active
  on public.payment_methods for select to authenticated
  using (is_active or public.has_permission('settings.view') or public.can_view_paiements());

drop policy if exists payment_methods_update_admin on public.payment_methods;
create policy payment_methods_update_admin
  on public.payment_methods for update to authenticated
  using (public.has_permission('settings.update'))
  with check (public.has_permission('settings.update'));

-- Ni INSERT ni DELETE : la liste des moyens est arrêtée par le schéma. En
-- ajouter un est une décision d'architecture, pas une manipulation d'écran.

/* ---------------------------------- orders -------------------------------- */

drop policy if exists orders_select_own on public.orders;
create policy orders_select_own
  on public.orders for select to authenticated
  using (user_id = auth.uid());

drop policy if exists orders_select_admin on public.orders;
create policy orders_select_admin
  on public.orders for select to authenticated
  using (public.can_view_commandes());

-- La mise à jour est ouverte à qui détient `orders.update` ; ce qui peut
-- réellement changer reste décidé par les déclencheurs — le statut par le
-- graphe, l'identité par l'immutabilité, le règlement par personne.
drop policy if exists orders_update_admin on public.orders;
create policy orders_update_admin
  on public.orders for update to authenticated
  using (public.has_permission('orders.update') or public.has_permission('orders.cancel'))
  with check (public.has_permission('orders.update') or public.has_permission('orders.cancel'));

-- Aucune politique INSERT : une commande naît d'une fonction, qui alloue sa
-- référence officielle. Aucune politique DELETE : § 92.

/* -------------------------------- order_items ----------------------------- */

drop policy if exists order_items_select_own on public.order_items;
create policy order_items_select_own
  on public.order_items for select to authenticated
  using (
    exists (select 1 from public.orders o
             where o.id = order_items.order_id and o.user_id = auth.uid())
  );

drop policy if exists order_items_select_admin on public.order_items;
create policy order_items_select_admin
  on public.order_items for select to authenticated
  using (public.can_view_commandes());

drop policy if exists order_items_write_admin on public.order_items;
create policy order_items_write_admin
  on public.order_items for insert to authenticated
  with check (public.has_permission('orders.update'));

drop policy if exists order_items_update_admin on public.order_items;
create policy order_items_update_admin
  on public.order_items for update to authenticated
  using (public.has_permission('orders.update'))
  with check (public.has_permission('orders.update'));

drop policy if exists order_items_delete_admin on public.order_items;
create policy order_items_delete_admin
  on public.order_items for delete to authenticated
  using (public.has_permission('orders.update'));

/* --------------------------------- payments ------------------------------- */

drop policy if exists payments_select_own on public.payments;
create policy payments_select_own
  on public.payments for select to authenticated
  using (
    exists (select 1 from public.orders o
             where o.id = payments.order_id and o.user_id = auth.uid())
  );

drop policy if exists payments_select_admin on public.payments;
create policy payments_select_admin
  on public.payments for select to authenticated
  using (public.can_view_paiements());

-- Seule la vérification écrit dans cette table depuis une session, et elle
-- exige la permission critique. Un client ne peut pas modifier son propre
-- paiement — § 178 en fait un test explicite.
drop policy if exists payments_update_admin on public.payments;
create policy payments_update_admin
  on public.payments for update to authenticated
  using (public.has_permission('payments.verify') or public.has_permission('payments.refund'))
  with check (public.has_permission('payments.verify') or public.has_permission('payments.refund'));

-- Aucune politique INSERT : `declare_payment` est le seul chemin, et il fixe
-- le statut de départ. Aucune politique DELETE : § 110.

/* ------------------------------ payment_proofs ---------------------------- */

drop policy if exists payment_proofs_select_own on public.payment_proofs;
create policy payment_proofs_select_own
  on public.payment_proofs for select to authenticated
  using (
    exists (
      select 1
        from public.payments p
        join public.orders o on o.id = p.order_id
       where p.id = payment_proofs.payment_id
         and o.user_id = auth.uid()
    )
  );

drop policy if exists payment_proofs_select_admin on public.payment_proofs;
create policy payment_proofs_select_admin
  on public.payment_proofs for select to authenticated
  using (public.can_view_paiements());

-- Ni INSERT, ni UPDATE, ni DELETE : `attach_payment_proof` vérifie la
-- propriété et la cohérence du chemin avant d'écrire.

/* ---------------------------------- refunds ------------------------------- */

drop policy if exists refunds_select_own on public.refunds;
create policy refunds_select_own
  on public.refunds for select to authenticated
  using (
    exists (select 1 from public.orders o
             where o.id = refunds.order_id and o.user_id = auth.uid())
  );

drop policy if exists refunds_select_admin on public.refunds;
create policy refunds_select_admin
  on public.refunds for select to authenticated
  using (public.can_view_paiements() or public.can_view_commandes());

-- Écriture par fonction uniquement.

/* --------------------- historique et journal métier ----------------------- */

drop policy if exists osh_select_own on public.order_status_history;
create policy osh_select_own
  on public.order_status_history for select to authenticated
  using (
    exists (select 1 from public.orders o
             where o.id = order_status_history.order_id and o.user_id = auth.uid())
  );

drop policy if exists osh_select_admin on public.order_status_history;
create policy osh_select_admin
  on public.order_status_history for select to authenticated
  using (public.can_view_commandes());

drop policy if exists order_events_select_own on public.order_events;
create policy order_events_select_own
  on public.order_events for select to authenticated
  using (
    exists (select 1 from public.orders o
             where o.id = order_events.order_id and o.user_id = auth.uid())
  );

drop policy if exists order_events_select_admin on public.order_events;
create policy order_events_select_admin
  on public.order_events for select to authenticated
  using (public.can_view_commandes());


-- -----------------------------------------------------------------------------
-- 18. CE QUI RESTE AUX PHASES SUIVANTES
--
--   * **4H — affiliation.** Rien n'est calculé ici, et c'est délibéré. Mais
--     `orders` porte un titulaire, une date, un montant et un état de
--     règlement vérifiable, et `payments` porte la date de confirmation : une
--     conversion pourra s'y rattacher sans que le commerce soit refondu.
--   * **4I — espaces client et affilié.** La RLS de cette migration décide
--     déjà qui voit quoi ; il restera à construire les écrans.
--   * **4J — notifications.** Aucun déclencheur n'envoie de message. Les
--     événements du journal métier sont précisément ce sur quoi 4J se
--     branchera.
--   * **Passerelles.** `processing_mode`, `external_reference` et
--     `external_status` sont en place, vides. Brancher Wakati ou PayPal
--     demandera une fonction de confirmation serveur et une vérification de
--     signature — pas une nouvelle table de commandes.
--   * **Acomptes et paiements partiels.** § 99 et § 102 les réservent à une
--     décision commerciale qui n'a pas été prise. Plusieurs paiements par
--     commande sont possibles — le § 49 l'exige — mais aucun acompte n'est
--     proposé, aucun pourcentage n'est inventé, et le type documentaire ACCL
--     reste sans emploi.
-- -----------------------------------------------------------------------------
