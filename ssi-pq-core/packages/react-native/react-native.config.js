module.exports = {
  dependency: {
    platforms: {
      android: {
        sourceDir: './android',
        packageImportPath: 'import com.ssipq.reactnative.SsiPqPackage;',
        packageInstance: 'new SsiPqPackage()',
      },
      ios: {
        podspecPath: './ios/SsiPqReactNative.podspec',
      },
    },
  },
};
