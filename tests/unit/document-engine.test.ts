import { test } from "node:test";
import assert from "node:assert";
import {
  buildDocumentId,
  buildDocumentFileName,
  normalizeEntityName,
} from "../../lib/document-engine";

test("buildDocumentId — format officiel MORA-[TYPE]-[SÉRIE][NUMÉRO]", () => {
  assert.equal(buildDocumentId("FACL", 1, 1), "MORA-FACL-A0001");
  assert.equal(buildDocumentId("DVCL", 1, 12), "MORA-DVCL-A0012");
  assert.equal(buildDocumentId("CMCL", 2, 1), "MORA-CMCL-B0001");
  assert.equal(buildDocumentId("COMAF", 1, 7), "MORA-COMAF-A0007");
});

test("buildDocumentId — passage à une seconde série alphabétique", () => {
  assert.equal(buildDocumentId("FACL", 26, 1), "MORA-FACL-Z0001");
  assert.equal(buildDocumentId("FACL", 27, 1), "MORA-FACL-AA0001");
});

test("buildDocumentId — numéro sur 4 chiffres", () => {
  assert.equal(buildDocumentId("FACL", 1, 9999), "MORA-FACL-A9999");
});

test("normalizeEntityName — normalise le nom (accents, espaces, caractères interdits)", () => {
  assert.equal(normalizeEntityName("Mohamed Ali"), "Mohamed-Ali");
  assert.equal(normalizeEntityName("Amina Ahmed"), "Amina-Ahmed");
  assert.equal(normalizeEntityName("Jean-Baptiste Dupont"), "Jean-Baptiste-Dupont");
  assert.equal(normalizeEntityName("a/b:c*d?e\"f<g>h|i"), "a-b-c-d-e-f-g-h-i");
});

test("buildDocumentFileName — identifiant stable + nom normalisé", () => {
  assert.equal(
    buildDocumentFileName("MORA-FACL-A0001", "Mohamed Ali"),
    "MORA-FACL-A0001_Mohamed-Ali.pdf",
  );
  assert.equal(
    buildDocumentFileName("MORA-COMAF-A0001", "Amina Ahmed"),
    "MORA-COMAF-A0001_Amina-Ahmed.pdf",
  );
});

test("L'identifiant officiel reste stable même si le nom change", () => {
  const id = "MORA-FACL-A0001";
  assert.ok(buildDocumentFileName(id, "Ancien Nom").startsWith(id));
  assert.ok(buildDocumentFileName(id, "Nouveau Nom").startsWith(id));
});
