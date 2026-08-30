import { test } from "node:test";
import assert from "node:assert";
import { resolveRate, commissionAmount, formatRate } from "../../lib/affiliation";

test("resolveRate — taux = min(taux catégorie, plafond service)", () => {
  assert.equal(resolveRate(0.1, null), 0.1); // particulier, pas de plafond
  assert.equal(resolveRate(0.15, 0.2), 0.15); // influenceur, plafond supérieur -> taux
  assert.equal(resolveRate(0.2, 0.1), 0.1); // équipe, plafond inférieur -> plafond
});

test("commissionAmount — montant arrondi (KMF)", () => {
  assert.equal(commissionAmount(50000, 0.1), 5000); // 10 %
  assert.equal(commissionAmount(50000, 0.15), 7500); // 15 %
  assert.equal(commissionAmount(30000, 0.2), 6000); // 20 %
  assert.equal(commissionAmount(250, 0.1), 25);
});

test("formatRate — affichage du taux", () => {
  assert.equal(formatRate(0.1), "10 %");
  assert.equal(formatRate(0.15), "15 %");
  assert.equal(formatRate(0.2), "20 %");
});
