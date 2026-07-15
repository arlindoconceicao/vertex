require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name = 'SsiPqReactNative'
  s.version = package['version']
  s.summary = package['description']
  s.license = package['license']
  s.homepage = 'https://github.com/ssi-pq/ssi-pq-core'
  s.authors = { 'SSI-PQ' => 'dev@ssi-pq.local' }
  s.source = { git: 'https://github.com/ssi-pq/ssi-pq-core.git', tag: s.version.to_s }

  s.platforms = { ios: '15.1' }
  s.swift_version = '5.9'
  s.source_files = 'Sources/**/*.{h,m,mm,swift}'
  s.vendored_frameworks = 'Frameworks/SsiPqMobile.xcframework'
  s.preserve_paths = [
    'Frameworks/SsiPqMobile.xcframework',
    'Sources/Generated/ssi_pq_mobile_ffiFFI.h',
    'Sources/Generated/ssi_pq_mobile_ffiFFI.modulemap',
  ]

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_VERSION' => '5.9',
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++20',
    'HEADER_SEARCH_PATHS' => [
      '"$(PODS_TARGET_SRCROOT)/Sources/Generated"',
      '"$(PODS_TARGET_SRCROOT)/Frameworks/SsiPqMobile.xcframework/ios-arm64/Headers"',
      '"$(PODS_TARGET_SRCROOT)/Frameworks/SsiPqMobile.xcframework/ios-arm64_x86_64-simulator/Headers"',
      '"$(PODS_ROOT)/Headers/Public/React-Codegen"',
      '"$(PODS_ROOT)/Headers/Private/React-Codegen"',
    ].join(' '),
  }

  if respond_to?(:install_modules_dependencies, true)
    install_modules_dependencies(s)
  else
    s.dependency 'React-Core'
  end
end
