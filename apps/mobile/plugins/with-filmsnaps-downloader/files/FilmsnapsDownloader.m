#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(FilmsnapsDownloader, RCTEventEmitter)

RCT_EXTERN_METHOD(startDownload:(NSString *)taskId
                  url:(NSString *)url
                  fileName:(NSString *)fileName
                  headers:(NSDictionary *)headers
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(pauseDownload:(NSString *)taskId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(resumeDownload:(NSString *)taskId
                  url:(NSString *)url
                  fileName:(NSString *)fileName
                  offsetBytes:(double)offsetBytes
                  headers:(NSDictionary *)headers
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(cancelDownload:(NSString *)taskId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getAvailableStorage:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
