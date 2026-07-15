package com.ssipq.mobiletest

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import uniffi.ssi_pq_mobile_ffi.SsiPq
import java.io.File
import java.math.BigInteger
import java.text.Normalizer
import java.util.Locale
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class SsiPqAndroidNestedLabelsEncryptedPdfFlowTest {
    @Test
    fun encryptedPdfWithNestedSchemaAndPortugueseLabelsRunsInsideAndroidApp() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val runId = UUID.randomUUID().toString()
        val storageDir = File(context.noBackupFilesDir, "ssi-pq-nested-labels-$runId").apply { mkdirs() }
        val api = SsiPq.newWithStorageDir(storageDir.absolutePath)

        try {
            val createdAt = "2026-05-27T00:00:00Z"
            val senderWallet = "sender-$runId"
            val senderPassword = "senha-remetente-labels-123"
            val recipientWallet = "recipient-$runId"
            val recipientPassword = "senha-destinatario-labels-456"

            api.walletCreateJson(senderWallet, senderPassword, """{"createdAt":"$createdAt"}""")
            val senderDidResult =
                JSONObject(
                    api.walletCreateDidJson(
                        senderWallet,
                        senderPassword,
                        """
                        {
                          "label": "Remetente",
                          "mldsa": "ML-DSA-65",
                          "mlkem": "ML-KEM-768",
                          "createdAt": "$createdAt"
                        }
                        """.trimIndent(),
                    ),
                )
            val senderDid = senderDidResult.getString("did")
            val senderDidDocumentJson = api.walletGetDidDocumentJson(senderWallet, senderPassword, senderDid)

            api.walletCreateJson(recipientWallet, recipientPassword, """{"createdAt":"$createdAt"}""")
            val recipientDidResult =
                JSONObject(
                    api.walletCreateDidJson(
                        recipientWallet,
                        recipientPassword,
                        """
                        {
                          "label": "Destinatário",
                          "mldsa": "ML-DSA-65",
                          "mlkem": "ML-KEM-768",
                          "createdAt": "$createdAt"
                        }
                        """.trimIndent(),
                    ),
                )
            val recipientDid = recipientDidResult.getString("did")
            val recipientDidDocumentJson =
                api.walletGetDidDocumentJson(recipientWallet, recipientPassword, recipientDid)
            val recipientDidDocument = JSONObject(recipientDidDocumentJson)

            val attributesJson =
                """
                {
                  "titular": {
                    "nome": "Alice Silva",
                    "documento": {
                      "tipo": "CPF",
                      "numero": "123.456.789-00"
                    }
                  },
                  "formacao": {
                    "curso": "Criptografia Pós-Quântica",
                    "instituicao": {
                      "nome": "SSI-PQ Academy",
                      "cidade": "São Paulo"
                    }
                  },
                  "endereco": {
                    "rua": "Rua São José",
                    "numero": 42,
                    "cidade": "São Paulo"
                  },
                  "nivel": "Avançado"
                }
                """.trimIndent()
            val visiblePathsJson =
                JSONArray()
                    .put("titular.nome")
                    .put("titular.documento.tipo")
                    .put("titular.documento.numero")
                    .put("formacao.curso")
                    .put("formacao.instituicao.nome")
                    .put("endereco.cidade")
                    .put("nivel")
            val pdfLabelsJson =
                JSONObject()
                    .put("endereco", "Endereço")
                    .put("endereco.cidade", "Cidade")
                    .put("formacao", "Formação")
                    .put("formacao.curso", "Curso")
                    .put("formacao.instituicao", "Instituição")
                    .put("formacao.instituicao.nome", "Nome")
                    .put("nivel", "Nível")
                    .put("titular", "Titular")
                    .put("titular.documento", "Documento")
                    .put("titular.documento.tipo", "Tipo")
                    .put("titular.nome", "Nome")

            val schemaJson =
                api.createSchemaFromAttributes(
                    attributesJson,
                    """{"version":"1","createdAt":"$createdAt"}""",
                )
            val signedCredentialJson =
                api.walletIssueCredentialFromSchemaJson(
                    senderWallet,
                    senderPassword,
                    senderDid,
                    schemaJson,
                    attributesJson,
                    JSONObject()
                        .put("credentialId", "cred_nested_wallet_pdf_labels_test")
                        .put("issuedAt", createdAt)
                        .put("visiblePaths", visiblePathsJson)
                        .toString(),
                )
            assertTrue(
                JSONObject(api.verifySignedCredential(signedCredentialJson, senderDidDocumentJson))
                    .getBoolean("valid"),
            )

            val pdfBase =
                api.signedCredentialToPdf(
                    signedCredentialJson,
                    JSONObject().put("labels", pdfLabelsJson).toString(),
                )
            val pdfBaseText = pdfBase.toString(Charsets.ISO_8859_1)
            assertTrue(pdfBaseText.contains(winAnsiHex("Endereço")))
            assertTrue(pdfBaseText.contains(winAnsiHex("Formação")))
            assertTrue(pdfBaseText.contains(winAnsiHex("Documento > Numero: 123.456.789-00")))
            assertTrue(pdfBaseText.contains(winAnsiHex("Documento > Tipo: CPF")))
            assertTrue(pdfBaseText.contains(winAnsiHex("Instituição > Nome: SSI-PQ Academy")))
            assertTrue(pdfBaseText.contains(winAnsiHex("Nível: Avançado")))
            assertTrue(pdfBaseText.contains(winAnsiHex("Cidade: São Paulo")))

            val finalPdf =
                api.walletEmbedSignedCredentialInPdfBytes(
                    senderWallet,
                    senderPassword,
                    senderDid,
                    pdfBase,
                    signedCredentialJson,
                    """{"createdAt":"$createdAt"}""",
                )
            assertEquals("%PDF-", finalPdf.copyOfRange(0, 5).toString(Charsets.UTF_8))

            val mlkemKey = findDidKey(recipientDidDocument, "#mlkem-1")
            assertEquals("ML-KEM-768", mlkemKey.getString("type"))
            val recipientPubKeyBytes = decodeBase58Btc(mlkemKey.getString("public_key_multibase"))
            val encapsulation = api.mlkemEncapsulate("ML-KEM-768", recipientPubKeyBytes)
            val sharedSecretSender = encapsulation.sharedSecret

            val encrypted = api.aes256GcmEncrypt(sharedSecretSender, finalPdf, null)
            val encryptedPdfPath = File(storageDir, "credencial-labels-$runId.pdf.enc")
            encryptedPdfPath.writeBytes(encrypted.ciphertext)
            val diskEncryptedBytes = encryptedPdfPath.readBytes()
            assertFalse(diskEncryptedBytes.copyOfRange(0, 5).toString(Charsets.UTF_8) == "%PDF-")

            val recoveredSecretBase64url =
                api.walletMlkemDecapsulate(
                    recipientWallet,
                    recipientPassword,
                    recipientDid,
                    api.base64urlEncode(encapsulation.ciphertext),
                )
            val sharedSecretRecipient = api.base64urlDecode(recoveredSecretBase64url)
            assertArrayEquals(sharedSecretSender, sharedSecretRecipient)

            val decryptedPdf =
                api.aes256GcmDecrypt(
                    sharedSecretRecipient,
                    diskEncryptedBytes,
                    encrypted.nonce,
                    encrypted.authTag,
                    null,
                )
            assertEquals("%PDF-", decryptedPdf.copyOfRange(0, 5).toString(Charsets.UTF_8))
            File(storageDir, "credencial-labels-decifrada-$runId.pdf").writeBytes(decryptedPdf)

            val verification = JSONObject(api.verifySignedCredentialPdf(decryptedPdf, senderDidDocumentJson))
            assertTrue(verification.getBoolean("valid"))

            val extractedManifest = JSONObject(api.extractCredentialManifestFromPdf(decryptedPdf))
            val extractedCredential = extractedManifest.getJSONObject("signed_credential")
            assertEquals("ssi_signed_credential_v2", extractedCredential.getString("type"))
            assertEquals(
                "cred_nested_wallet_pdf_labels_test",
                extractedCredential.getJSONObject("credential").getString("credential_id"),
            )
            assertEquals(
                listOf(
                    "subject.endereco.cidade" to "São Paulo",
                    "subject.formacao.curso" to "Criptografia Pós-Quântica",
                    "subject.formacao.instituicao.nome" to "SSI-PQ Academy",
                    "subject.nivel" to "Avançado",
                    "subject.titular.documento.numero" to "123.456.789-00",
                    "subject.titular.documento.tipo" to "CPF",
                    "subject.titular.nome" to "Alice Silva",
                ),
                disclosurePairs(extractedCredential.getJSONArray("attribute_disclosures")),
            )

            File(storageDir, "credencial-labels-manifest-$runId.json")
                .writeText(extractedManifest.toString(2), Charsets.UTF_8)
        } finally {
            api.close()
            storageDir.deleteRecursively()
        }
    }

    private fun findDidKey(
        didDocument: JSONObject,
        keyId: String,
    ): JSONObject {
        val keys = didDocument.getJSONArray("keys")
        for (index in 0 until keys.length()) {
            val key = keys.getJSONObject(index)
            if (key.getString("id") == keyId) {
                return key
            }
        }
        error("DID document must contain $keyId")
    }

    private fun disclosurePairs(disclosures: JSONArray): List<Pair<String, String>> =
        (0 until disclosures.length()).map { index ->
            val disclosure = disclosures.getJSONObject(index)
            disclosure.getString("path") to disclosure.get("value").toString()
        }

    private fun decodeBase58Btc(input: String): ByteArray {
        require(input.startsWith("z")) { "Not base58btc multibase" }
        val alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
        val data = input.substring(1)
        var value = BigInteger.ZERO
        for (char in data) {
            val digit = alphabet.indexOf(char)
            require(digit >= 0) { "Invalid base58btc character: $char" }
            value = value.multiply(BigInteger.valueOf(58)).add(BigInteger.valueOf(digit.toLong()))
        }
        val raw =
            value.toByteArray().let { bytes ->
                if (bytes.size > 1 && bytes[0] == 0.toByte()) bytes.copyOfRange(1, bytes.size) else bytes
            }
        val leadingZeros = data.takeWhile { it == '1' }.length
        return ByteArray(leadingZeros) + raw
    }

    private fun winAnsiHex(text: String): String {
        val normalized = Normalizer.normalize(text, Normalizer.Form.NFC)
        val output = StringBuilder()
        var offset = 0
        while (offset < normalized.length) {
            val codePoint = normalized.codePointAt(offset)
            val byte =
                when (codePoint) {
                    in 0x20..0x7e -> codePoint
                    in 0xa0..0xff -> codePoint
                    else -> 0x3f
                }
            output.append(byte.toString(16).padStart(2, '0').uppercase(Locale.US))
            offset += Character.charCount(codePoint)
        }
        return output.toString()
    }
}
