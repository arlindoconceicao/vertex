import Foundation
import React

@objc(SsiPqReactNative)
final class SsiPqReactNative: NSObject {
  private let workQueue = DispatchQueue(
    label: "com.ssipq.reactnative.work",
    qos: .userInitiated,
    attributes: .concurrent
  )

  private let ffi: SsiPq?
  private let initializationError: Error?

  override init() {
    do {
      let storageDirectory = try Self.prepareStorageDirectory()
      ffi = try SsiPq.newWithStorageDir(storageDir: storageDirectory.path)
      initializationError = nil
    } catch {
      ffi = nil
      initializationError = error
    }

    super.init()
  }

  @objc
  static func requiresMainQueueSetup() -> Bool {
    false
  }

  @objc(supportedProfiles:rejecter:)
  func supportedProfiles(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    runAsync(resolve, reject) { try self.ffiOrThrow().supportedProfiles() }
  }

  @objc(canonicalJson:resolver:rejecter:)
  func canonicalJson(
    _ input: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    runAsync(resolve, reject) { try self.ffiOrThrow().canonicalJson(input: input) }
  }

  @objc(canonicalJsonHashBase64url:resolver:rejecter:)
  func canonicalJsonHashBase64url(
    _ input: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    runAsync(resolve, reject) { try self.ffiOrThrow().canonicalJsonHashBase64url(input: input) }
  }

  @objc(sha3_256Base64url:resolver:rejecter:)
  func sha3_256Base64url(
    _ bytesBase64: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    runAsync(resolve, reject) {
      try self.ffiOrThrow().sha3_256Base64url(bytes: try Self.decodeBase64(bytesBase64))
    }
  }

  @objc(sha3_256Hex:resolver:rejecter:)
  func sha3_256Hex(
    _ bytesBase64: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    runAsync(resolve, reject) {
      try self.ffiOrThrow().sha3_256Hex(bytes: try Self.decodeBase64(bytesBase64))
    }
  }

  @objc(base64urlEncode:resolver:rejecter:)
  func base64urlEncode(
    _ bytesBase64: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    runAsync(resolve, reject) {
      try self.ffiOrThrow().base64urlEncode(bytes: try Self.decodeBase64(bytesBase64))
    }
  }

  @objc(base64urlDecodeToBase64:resolver:rejecter:)
  func base64urlDecodeToBase64(
    _ value: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    runAsync(resolve, reject) {
      try self.ffiOrThrow().base64urlDecode(value: value).base64EncodedString()
    }
  }

  @objc(createSchemaFromAttributes:optionsJson:resolver:rejecter:)
  func createSchemaFromAttributes(
    _ attributesJson: String,
    optionsJson: String?,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    runAsync(resolve, reject) {
      try self.ffiOrThrow().createSchemaFromAttributes(
        attributesJson: attributesJson,
        optionsJson: optionsJson
      )
    }
  }

  @objc(verifyDidDocument:resolver:rejecter:)
  func verifyDidDocument(
    _ didDocumentJson: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    runAsync(resolve, reject) {
      try self.ffiOrThrow().verifyDidDocument(didDocumentJson: didDocumentJson)
    }
  }

  @objc(verifySignedCredential:issuerDidDocumentJson:resolver:rejecter:)
  func verifySignedCredential(
    _ signedCredentialJson: String,
    issuerDidDocumentJson: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    runAsync(resolve, reject) {
      try self.ffiOrThrow().verifySignedCredential(
        signedCredentialJson: signedCredentialJson,
        issuerDidDocumentJson: issuerDidDocumentJson
      )
    }
  }

  @objc(verifySignedCredentialPdfFile:issuerDidDocumentJson:resolver:rejecter:)
  func verifySignedCredentialPdfFile(
    _ inputUri: String,
    issuerDidDocumentJson: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    runAsync(resolve, reject) {
      try self.withSecurityScopedAccess(inputUri) {
        try self.ffiOrThrow().verifySignedCredentialPdfFile(
          inputUri: Self.rustFileUri(inputUri),
          issuerDidDocumentJson: issuerDidDocumentJson
        )
      }
    }
  }

  @objc(verifySignedGenericPdfFile:signerDidDocumentJson:resolver:rejecter:)
  func verifySignedGenericPdfFile(
    _ inputUri: String,
    signerDidDocumentJson: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    runAsync(resolve, reject) {
      try self.withSecurityScopedAccess(inputUri) {
        try self.ffiOrThrow().verifySignedGenericPdfFile(
          inputUri: Self.rustFileUri(inputUri),
          signerDidDocumentJson: signerDidDocumentJson
        )
      }
    }
  }

  @objc(walletCreateJson:password:optionsJson:resolver:rejecter:)
  func walletCreateJson(
    _ walletName: String,
    password: String,
    optionsJson: String?,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    runAsync(resolve, reject) {
      try self.ffiOrThrow().walletCreateJson(
        walletName: walletName,
        password: password,
        optionsJson: optionsJson
      )
    }
  }

  @objc(walletOpenJson:password:resolver:rejecter:)
  func walletOpenJson(
    _ walletName: String,
    password: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    runAsync(resolve, reject) {
      try self.ffiOrThrow().walletOpenJson(walletName: walletName, password: password)
    }
  }

  @objc(walletChangePasswordJson:oldPassword:newPassword:resolver:rejecter:)
  func walletChangePasswordJson(
    _ walletName: String,
    oldPassword: String,
    newPassword: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    runAsync(resolve, reject) {
      try self.ffiOrThrow().walletChangePasswordJson(
        walletName: walletName,
        oldPassword: oldPassword,
        newPassword: newPassword
      )
    }
  }

  @objc(walletCreateDidJson:password:optionsJson:resolver:rejecter:)
  func walletCreateDidJson(
    _ walletName: String,
    password: String,
    optionsJson: String?,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    runAsync(resolve, reject) {
      try self.ffiOrThrow().walletCreateDidJson(
        walletName: walletName,
        password: password,
        optionsJson: optionsJson
      )
    }
  }

  @objc(walletListDidsJson:password:resolver:rejecter:)
  func walletListDidsJson(
    _ walletName: String,
    password: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    runAsync(resolve, reject) {
      try self.ffiOrThrow().walletListDidsJson(walletName: walletName, password: password)
    }
  }

  @objc(walletGetDidDocumentJson:password:did:resolver:rejecter:)
  func walletGetDidDocumentJson(
    _ walletName: String,
    password: String,
    did: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    runAsync(resolve, reject) {
      try self.ffiOrThrow().walletGetDidDocumentJson(
        walletName: walletName,
        password: password,
        did: did
      )
    }
  }

  @objc(
    walletIssueCredentialFromSchemaJson:password:did:schemaJson:attributesJson:optionsJson:resolver:
    rejecter:
  )
  func walletIssueCredentialFromSchemaJson(
    _ walletName: String,
    password: String,
    did: String,
    schemaJson: String,
    attributesJson: String,
    optionsJson: String?,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    runAsync(resolve, reject) {
      try self.ffiOrThrow().walletIssueCredentialFromSchemaJson(
        walletName: walletName,
        password: password,
        did: did,
        schemaJson: schemaJson,
        attributesJson: attributesJson,
        optionsJson: optionsJson
      )
    }
  }

  @objc(
    walletEmbedSignedCredentialInPdfFile:password:did:inputUri:outputUri:signedCredentialJson:
    optionsJson:resolver:rejecter:
  )
  func walletEmbedSignedCredentialInPdfFile(
    _ walletName: String,
    password: String,
    did: String,
    inputUri: String,
    outputUri: String,
    signedCredentialJson: String,
    optionsJson: String?,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    runAsync(resolve, reject) {
      try self.withSecurityScopedAccess(inputUri) {
        try self.withSecurityScopedAccess(outputUri) {
          let result = try self.ffiOrThrow().walletEmbedSignedCredentialInPdfFile(
            walletName: walletName,
            password: password,
            did: did,
            inputUri: Self.rustFileUri(inputUri),
            outputUri: Self.rustFileUri(outputUri),
            signedCredentialJson: signedCredentialJson,
            optionsJson: optionsJson
          )
          return try Self.fileOperationResultJson(result, outputUri: outputUri)
        }
      }
    }
  }

  @objc(walletSignGenericPdfFile:password:did:inputUri:outputUri:optionsJson:resolver:rejecter:)
  func walletSignGenericPdfFile(
    _ walletName: String,
    password: String,
    did: String,
    inputUri: String,
    outputUri: String,
    optionsJson: String?,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    runAsync(resolve, reject) {
      try self.withSecurityScopedAccess(inputUri) {
        try self.withSecurityScopedAccess(outputUri) {
          let result = try self.ffiOrThrow().walletSignGenericPdfFile(
            walletName: walletName,
            password: password,
            did: did,
            inputUri: Self.rustFileUri(inputUri),
            outputUri: Self.rustFileUri(outputUri),
            optionsJson: optionsJson
          )
          return try Self.fileOperationResultJson(result, outputUri: outputUri)
        }
      }
    }
  }

  @objc(walletMlkemDecapsulate:password:did:ciphertext:resolver:rejecter:)
  func walletMlkemDecapsulate(
    _ walletName: String,
    password: String,
    did: String,
    ciphertext: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    runAsync(resolve, reject) {
      try self.ffiOrThrow().walletMlkemDecapsulate(
        walletName: walletName,
        password: password,
        did: did,
        ciphertext: ciphertext
      )
    }
  }

  private func runAsync(
    _ resolve: @escaping RCTPromiseResolveBlock,
    _ reject: @escaping RCTPromiseRejectBlock,
    _ work: @escaping () throws -> Any
  ) {
    workQueue.async {
      do {
        resolve(try work())
      } catch {
        reject("SSI_PQ_MOBILE_ERROR", error.localizedDescription, error)
      }
    }
  }

  private func ffiOrThrow() throws -> SsiPq {
    if let ffi {
      return ffi
    }

    throw initializationError ?? SsiPqReactNativeError.unavailable("SSI-PQ iOS FFI unavailable")
  }

  private func withSecurityScopedAccess<T>(
    _ uri: String,
    _ work: () throws -> T
  ) throws -> T {
    guard let url = URL(string: uri), url.isFileURL else {
      return try work()
    }

    let didStartAccessing = url.startAccessingSecurityScopedResource()
    defer {
      if didStartAccessing {
        url.stopAccessingSecurityScopedResource()
      }
    }
    return try work()
  }

  private static func prepareStorageDirectory() throws -> URL {
    let baseDirectory = try FileManager.default.url(
      for: .applicationSupportDirectory,
      in: .userDomainMask,
      appropriateFor: nil,
      create: true
    )
    let storageDirectory = baseDirectory.appendingPathComponent(
      "ssi-pq-mobile-ffi",
      isDirectory: true
    )
    try FileManager.default.createDirectory(
      at: storageDirectory,
      withIntermediateDirectories: true
    )

    var mutableStorageDirectory = storageDirectory
    var resourceValues = URLResourceValues()
    resourceValues.isExcludedFromBackup = true
    try mutableStorageDirectory.setResourceValues(resourceValues)

    return storageDirectory
  }

  private static func rustFileUri(_ uri: String) -> String {
    guard let url = URL(string: uri), url.isFileURL else {
      return uri
    }
    return url.path
  }

  private static func decodeBase64(_ value: String) throws -> Data {
    guard let data = Data(base64Encoded: value) else {
      throw SsiPqReactNativeError.invalidInput("invalid base64 input")
    }
    return data
  }

  private static func fileOperationResultJson(
    _ result: FileOperationResult,
    outputUri: String
  ) throws -> String {
    let value: [String: Any] = [
      "outputUri": outputUri,
      "bytesWritten": NSNumber(value: result.bytesWritten),
      "metadataJson": result.metadataJson as Any? ?? NSNull(),
    ]
    let data = try JSONSerialization.data(withJSONObject: value, options: [])
    return String(data: data, encoding: .utf8) ?? "{}"
  }
}

private enum SsiPqReactNativeError: LocalizedError {
  case invalidInput(String)
  case unavailable(String)

  var errorDescription: String? {
    switch self {
    case .invalidInput(let message):
      return message
    case .unavailable(let message):
      return message
    }
  }
}
