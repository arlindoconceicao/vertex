#import <React/RCTBridgeModule.h>

#ifdef RCT_NEW_ARCH_ENABLED
#import <ReactCommon/RCTTurboModule.h>
#import <SsiPqSpec/SsiPqSpec.h>
#import <memory>
#endif

@interface RCT_EXTERN_REMAP_MODULE(SsiPq, SsiPqReactNative, NSObject)

RCT_EXTERN_METHOD(supportedProfiles
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(canonicalJson
                  : (NSString *)input resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(canonicalJsonHashBase64url
                  : (NSString *)input resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(sha3_256Base64url
                  : (NSString *)bytesBase64 resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(sha3_256Hex
                  : (NSString *)bytesBase64 resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(base64urlEncode
                  : (NSString *)bytesBase64 resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(base64urlDecodeToBase64
                  : (NSString *)value resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(createSchemaFromAttributes
                  : (NSString *)attributesJson optionsJson
                  : (NSString *)optionsJson resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(verifyDidDocument
                  : (NSString *)didDocumentJson resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(verifySignedCredential
                  : (NSString *)signedCredentialJson issuerDidDocumentJson
                  : (NSString *)issuerDidDocumentJson resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(verifySignedCredentialPdfFile
                  : (NSString *)inputUri issuerDidDocumentJson
                  : (NSString *)issuerDidDocumentJson resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(verifySignedGenericPdfFile
                  : (NSString *)inputUri signerDidDocumentJson
                  : (NSString *)signerDidDocumentJson resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(walletCreateJson
                  : (NSString *)walletName password
                  : (NSString *)password optionsJson
                  : (NSString *)optionsJson resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(walletOpenJson
                  : (NSString *)walletName password
                  : (NSString *)password resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(walletChangePasswordJson
                  : (NSString *)walletName oldPassword
                  : (NSString *)oldPassword newPassword
                  : (NSString *)newPassword resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(walletCreateDidJson
                  : (NSString *)walletName password
                  : (NSString *)password optionsJson
                  : (NSString *)optionsJson resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(walletListDidsJson
                  : (NSString *)walletName password
                  : (NSString *)password resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(walletGetDidDocumentJson
                  : (NSString *)walletName password
                  : (NSString *)password did
                  : (NSString *)did resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(walletIssueCredentialFromSchemaJson
                  : (NSString *)walletName password
                  : (NSString *)password did
                  : (NSString *)did schemaJson
                  : (NSString *)schemaJson attributesJson
                  : (NSString *)attributesJson optionsJson
                  : (NSString *)optionsJson resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(walletEmbedSignedCredentialInPdfFile
                  : (NSString *)walletName password
                  : (NSString *)password did
                  : (NSString *)did inputUri
                  : (NSString *)inputUri outputUri
                  : (NSString *)outputUri signedCredentialJson
                  : (NSString *)signedCredentialJson optionsJson
                  : (NSString *)optionsJson resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(walletSignGenericPdfFile
                  : (NSString *)walletName password
                  : (NSString *)password did
                  : (NSString *)did inputUri
                  : (NSString *)inputUri outputUri
                  : (NSString *)outputUri optionsJson
                  : (NSString *)optionsJson resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(walletMlkemDecapsulate
                  : (NSString *)walletName password
                  : (NSString *)password did
                  : (NSString *)did ciphertext
                  : (NSString *)ciphertext resolver
                  : (RCTPromiseResolveBlock)resolve rejecter
                  : (RCTPromiseRejectBlock)reject)

@end

#ifdef RCT_NEW_ARCH_ENABLED

@interface SsiPqReactNative () <NativeSsiPqSpec>
@end

@implementation SsiPqReactNative (TurboModule)

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeSsiPqSpecJSI>(params);
}

@end

#endif
