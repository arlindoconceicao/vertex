package com.ssipq.mobiletest

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import uniffi.ssi_pq_mobile_ffi.SsiPq
import java.io.File
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class SsiPqAndroidWalletPdfFlowTest {
    @Test
    fun walletDidCredentialAndPdfFlowRunsInsideAndroidApp() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val testId = UUID.randomUUID().toString()
        val storageDir = File(context.noBackupFilesDir, "ssi-pq-flow-$testId").apply { mkdirs() }
        val api = SsiPq.newWithStorageDir(storageDir.absolutePath)

        try {
            val createdAt = "2026-06-30T12:00:00Z"
            val issuedAt = createdAt
            val walletName = "android-wallet-$testId"
            val password = "android-test-password"

            val walletInfo =
                JSONObject(api.walletCreateJson(walletName, password, """{"createdAt":"$createdAt"}"""))
            assertEquals(0, walletInfo.getInt("did_count"))

            val didResult =
                JSONObject(
                    api.walletCreateDidJson(
                        walletName,
                        password,
                        """
                        {
                          "label": "Android instrumentation issuer",
                          "mldsa": "ML-DSA-65",
                          "mlkem": "ML-KEM-768",
                          "createdAt": "$createdAt"
                        }
                        """.trimIndent(),
                    ),
                )
            val did = didResult.getString("did")
            assertFalse("public DID result must not expose private keys", didResult.toString().contains("private", ignoreCase = true))

            val didDocumentJson = api.walletGetDidDocumentJson(walletName, password, did)
            val didDocument = JSONObject(didDocumentJson)
            assertEquals(did, didDocument.getString("id"))
            assertTrue(JSONObject(api.verifyDidDocument(didDocumentJson)).getBoolean("valid"))

            val dids = api.walletListDidsJson(walletName, password)
            assertTrue(dids.contains(did))

            val attributesJson =
                """
                {
                  "name": "Ana Silva",
                  "course": "Post-Quantum Credentials",
                  "level": "android instrumentation"
                }
                """.trimIndent()
            val schemaJson =
                api.createSchemaFromAttributes(
                    attributesJson,
                    """{"version":"1","createdAt":"$createdAt"}""",
                )
            assertTrue(api.schemaHashBase64(schemaJson).isNotBlank())

            val signedCredentialJson =
                api.walletIssueCredentialFromSchemaJson(
                    walletName,
                    password,
                    did,
                    schemaJson,
                    attributesJson,
                    """
                    {
                      "credentialId": "android-credential-$testId",
                      "issuedAt": "$issuedAt",
                      "visiblePaths": ["name", "course"],
                      "credentialVersion": "v2"
                    }
                    """.trimIndent(),
                )
            val credentialVerification =
                JSONObject(api.verifySignedCredential(signedCredentialJson, didDocumentJson))
            assertTrue(credentialVerification.getBoolean("valid"))

            val credentialBasePdf = api.signedCredentialToPdf(signedCredentialJson, null)
            val credentialInput = File(storageDir, "credential-input.pdf")
            val credentialOutput = File(storageDir, "credential-output.pdf")
            credentialInput.writeBytes(credentialBasePdf)

            val credentialPdfResult =
                api.walletEmbedSignedCredentialInPdfFile(
                    walletName,
                    password,
                    did,
                    credentialInput.absolutePath,
                    credentialOutput.absolutePath,
                    signedCredentialJson,
                    """{"createdAt":"$createdAt"}""",
                )
            assertEquals(credentialOutput.length(), credentialPdfResult.bytesWritten.toLong())
            val credentialPdfVerification =
                JSONObject(api.verifySignedCredentialPdfFile(credentialOutput.absolutePath, didDocumentJson))
            assertTrue(credentialPdfVerification.getBoolean("valid"))

            val genericInput = File(storageDir, "generic-input.pdf")
            val genericOutput = File(storageDir, "generic-output.pdf")
            genericInput.writeBytes(minimalPdfBase())

            val genericPdfResult =
                api.walletSignGenericPdfFile(
                    walletName,
                    password,
                    did,
                    genericInput.absolutePath,
                    genericOutput.absolutePath,
                    """
                    {
                      "createdAt": "$createdAt",
                      "visualSignature": {
                        "mode": "visible",
                        "placement": "firstPageFooter",
                        "text": "SSI-PQ Android instrumentation test"
                      }
                    }
                    """.trimIndent(),
                )
            assertEquals(genericOutput.length(), genericPdfResult.bytesWritten.toLong())
            val genericPdfVerification =
                JSONObject(api.verifySignedGenericPdfFile(genericOutput.absolutePath, didDocumentJson))
            assertTrue(genericPdfVerification.getBoolean("valid"))
            assertTrue(genericPdfVerification.getBoolean("signature_valid"))
        } finally {
            api.close()
            storageDir.deleteRecursively()
        }
    }

    private fun minimalPdfBase(): ByteArray =
        (
            "%PDF-1.4\n%ABCD\n" +
                "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
                "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n" +
                "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>\nendobj\n" +
                "xref\n0 4\n" +
                "0000000000 65535 f \n" +
                "0000000015 00000 n \n" +
                "0000000064 00000 n \n" +
                "0000000121 00000 n \n" +
                "trailer\n<< /Size 4 /Root 1 0 R >>\n" +
                "startxref\n192\n" +
                "%%EOF\n"
        ).toByteArray(Charsets.UTF_8)
}
