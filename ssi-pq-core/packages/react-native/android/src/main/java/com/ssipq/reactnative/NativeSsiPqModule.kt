package com.ssipq.reactnative

import android.net.Uri
import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableNativeArray
import com.facebook.react.module.annotations.ReactModule
import org.json.JSONObject
import uniffi.ssi_pq_mobile_ffi.FileOperationResult
import uniffi.ssi_pq_mobile_ffi.SsiPq
import java.io.File
import java.util.UUID
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import kotlin.math.max

@ReactModule(name = NativeSsiPqModule.NAME)
class NativeSsiPqModule(
    private val reactContext: ReactApplicationContext,
) : NativeSsiPqSpec(reactContext) {
    private val executor: ExecutorService =
        Executors.newFixedThreadPool(max(2, Runtime.getRuntime().availableProcessors() - 1))

    private val ffiHolder =
        lazy {
            val storageDir = File(reactContext.noBackupFilesDir, "ssi-pq-mobile-ffi")
            storageDir.mkdirs()
            SsiPq.newWithStorageDir(storageDir.absolutePath)
        }

    private val ffi: SsiPq by ffiHolder

    override fun getName(): String = NAME

    override fun invalidate() {
        executor.shutdown()
        if (ffiHolder.isInitialized()) {
            ffi.close()
        }
        super.invalidate()
    }

    override fun supportedProfiles(promise: Promise) {
        runAsync(promise) {
            WritableNativeArray().also { output ->
                ffi.supportedProfiles().forEach(output::pushString)
            }
        }
    }

    override fun canonicalJson(
        input: String,
        promise: Promise,
    ) {
        runAsync(promise) { ffi.canonicalJson(input) }
    }

    override fun canonicalJsonHashBase64url(
        input: String,
        promise: Promise,
    ) {
        runAsync(promise) { ffi.canonicalJsonHashBase64url(input) }
    }

    override fun sha3_256Base64url(
        bytesBase64: String,
        promise: Promise,
    ) {
        runAsync(promise) { ffi.sha3_256Base64url(decodeBase64(bytesBase64)) }
    }

    override fun sha3_256Hex(
        bytesBase64: String,
        promise: Promise,
    ) {
        runAsync(promise) { ffi.sha3_256Hex(decodeBase64(bytesBase64)) }
    }

    override fun base64urlEncode(
        bytesBase64: String,
        promise: Promise,
    ) {
        runAsync(promise) { ffi.base64urlEncode(decodeBase64(bytesBase64)) }
    }

    override fun base64urlDecodeToBase64(
        value: String,
        promise: Promise,
    ) {
        runAsync(promise) { encodeBase64(ffi.base64urlDecode(value)) }
    }

    override fun createSchemaFromAttributes(
        attributesJson: String,
        optionsJson: String?,
        promise: Promise,
    ) {
        runAsync(promise) { ffi.createSchemaFromAttributes(attributesJson, optionsJson) }
    }

    override fun verifyDidDocument(
        didDocumentJson: String,
        promise: Promise,
    ) {
        runAsync(promise) { ffi.verifyDidDocument(didDocumentJson) }
    }

    override fun verifySignedCredential(
        signedCredentialJson: String,
        issuerDidDocumentJson: String,
        promise: Promise,
    ) {
        runAsync(promise) {
            ffi.verifySignedCredential(signedCredentialJson, issuerDidDocumentJson)
        }
    }

    override fun verifySignedCredentialPdfFile(
        inputUri: String,
        issuerDidDocumentJson: String,
        promise: Promise,
    ) {
        runAsync(promise) {
            withResolvedInputUri(inputUri) { resolvedInputUri ->
                ffi.verifySignedCredentialPdfFile(resolvedInputUri, issuerDidDocumentJson)
            }
        }
    }

    override fun verifySignedGenericPdfFile(
        inputUri: String,
        signerDidDocumentJson: String,
        promise: Promise,
    ) {
        runAsync(promise) {
            withResolvedInputUri(inputUri) { resolvedInputUri ->
                ffi.verifySignedGenericPdfFile(resolvedInputUri, signerDidDocumentJson)
            }
        }
    }

    override fun walletCreateJson(
        walletName: String,
        password: String,
        optionsJson: String?,
        promise: Promise,
    ) {
        runAsync(promise) { ffi.walletCreateJson(walletName, password, optionsJson) }
    }

    override fun walletOpenJson(
        walletName: String,
        password: String,
        promise: Promise,
    ) {
        runAsync(promise) { ffi.walletOpenJson(walletName, password) }
    }

    override fun walletChangePasswordJson(
        walletName: String,
        oldPassword: String,
        newPassword: String,
        promise: Promise,
    ) {
        runAsync(promise) { ffi.walletChangePasswordJson(walletName, oldPassword, newPassword) }
    }

    override fun walletCreateDidJson(
        walletName: String,
        password: String,
        optionsJson: String?,
        promise: Promise,
    ) {
        runAsync(promise) { ffi.walletCreateDidJson(walletName, password, optionsJson) }
    }

    override fun walletListDidsJson(
        walletName: String,
        password: String,
        promise: Promise,
    ) {
        runAsync(promise) { ffi.walletListDidsJson(walletName, password) }
    }

    override fun walletGetDidDocumentJson(
        walletName: String,
        password: String,
        did: String,
        promise: Promise,
    ) {
        runAsync(promise) { ffi.walletGetDidDocumentJson(walletName, password, did) }
    }

    override fun walletIssueCredentialFromSchemaJson(
        walletName: String,
        password: String,
        did: String,
        schemaJson: String,
        attributesJson: String,
        optionsJson: String?,
        promise: Promise,
    ) {
        runAsync(promise) {
            ffi.walletIssueCredentialFromSchemaJson(
                walletName,
                password,
                did,
                schemaJson,
                attributesJson,
                optionsJson,
            )
        }
    }

    override fun walletEmbedSignedCredentialInPdfFile(
        walletName: String,
        password: String,
        did: String,
        inputUri: String,
        outputUri: String,
        signedCredentialJson: String,
        optionsJson: String?,
        promise: Promise,
    ) {
        runAsync(promise) {
            withResolvedInputUri(inputUri) { resolvedInputUri ->
                withOutputUri(outputUri) { rustOutputUri ->
                    ffi.walletEmbedSignedCredentialInPdfFile(
                        walletName,
                        password,
                        did,
                        resolvedInputUri,
                        rustOutputUri,
                        signedCredentialJson,
                        optionsJson,
                    )
                }
            }
        }
    }

    override fun walletSignGenericPdfFile(
        walletName: String,
        password: String,
        did: String,
        inputUri: String,
        outputUri: String,
        optionsJson: String?,
        promise: Promise,
    ) {
        runAsync(promise) {
            withResolvedInputUri(inputUri) { resolvedInputUri ->
                withOutputUri(outputUri) { rustOutputUri ->
                    ffi.walletSignGenericPdfFile(
                        walletName,
                        password,
                        did,
                        resolvedInputUri,
                        rustOutputUri,
                        optionsJson,
                    )
                }
            }
        }
    }

    override fun walletMlkemDecapsulate(
        walletName: String,
        password: String,
        did: String,
        ciphertext: String,
        promise: Promise,
    ) {
        runAsync(promise) { ffi.walletMlkemDecapsulate(walletName, password, did, ciphertext) }
    }

    private fun <T> runAsync(
        promise: Promise,
        block: () -> T,
    ) {
        executor.execute {
            try {
                promise.resolve(block())
            } catch (error: Throwable) {
                promise.reject("SSI_PQ_MOBILE_ERROR", error.message, error)
            }
        }
    }

    private fun resolveInputUri(inputUri: String): String {
        if (!inputUri.startsWith("content://")) {
            return inputUri
        }

        val target = File(reactContext.cacheDir, "ssi-pq-input-${UUID.randomUUID()}")
        reactContext.contentResolver.openInputStream(Uri.parse(inputUri)).use { input ->
            val source = requireNotNull(input) { "cannot open input URI: $inputUri" }
            target.outputStream().use { output -> source.copyTo(output) }
        }
        return target.absolutePath
    }

    private fun <T> withResolvedInputUri(
        inputUri: String,
        operation: (String) -> T,
    ): T {
        if (!inputUri.startsWith("content://")) {
            return operation(inputUri)
        }

        val target = File(resolveInputUri(inputUri))
        return try {
            operation(target.absolutePath)
        } finally {
            target.delete()
        }
    }

    private fun withOutputUri(
        outputUri: String,
        operation: (String) -> FileOperationResult,
    ): String {
        if (!outputUri.startsWith("content://")) {
            return fileOperationResultJson(operation(outputUri), outputUri)
        }

        val target = File(reactContext.cacheDir, "ssi-pq-output-${UUID.randomUUID()}.pdf")
        return try {
            val result = operation(target.absolutePath)
            reactContext.contentResolver.openOutputStream(Uri.parse(outputUri)).use { output ->
                val sink = requireNotNull(output) { "cannot open output URI: $outputUri" }
                target.inputStream().use { input -> input.copyTo(sink) }
            }
            fileOperationResultJson(result, outputUri)
        } finally {
            target.delete()
        }
    }

    private fun fileOperationResultJson(
        result: FileOperationResult,
        outputUri: String,
    ): String =
        JSONObject()
            .put("outputUri", outputUri)
            .put("bytesWritten", result.bytesWritten.toLong())
            .put("metadataJson", result.metadataJson ?: JSONObject.NULL)
            .toString()

    private fun decodeBase64(value: String): ByteArray = Base64.decode(value, Base64.NO_WRAP)

    private fun encodeBase64(value: ByteArray): String = Base64.encodeToString(value, Base64.NO_WRAP)

    companion object {
        const val NAME = "SsiPq"
    }
}
