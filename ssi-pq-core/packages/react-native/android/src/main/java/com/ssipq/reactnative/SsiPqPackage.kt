package com.ssipq.reactnative

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class SsiPqPackage : BaseReactPackage() {
    override fun getModule(
        name: String,
        reactContext: ReactApplicationContext,
    ): NativeModule? =
        if (name == NativeSsiPqModule.NAME) {
            NativeSsiPqModule(reactContext)
        } else {
            null
        }

    override fun getReactModuleInfoProvider(): ReactModuleInfoProvider =
        ReactModuleInfoProvider {
            mapOf(
                NativeSsiPqModule.NAME to
                    ReactModuleInfo(
                        NativeSsiPqModule.NAME,
                        NativeSsiPqModule.NAME,
                        false,
                        false,
                        false,
                        false,
                        true,
                    ),
            )
        }
}
