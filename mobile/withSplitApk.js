const { withAppBuildGradle } = require('@expo/config-plugins');

const withSplitApk = (config) => {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.language === 'groovy') {
      const splitBlock = `
    splits {
        abi {
            reset()
            enable true
            universalApk false
            include "armeabi-v7a", "arm64-v8a", "x86", "x86_64"
        }
    }
`;
      // Inject inside the android { ... } block
      config.modResults.contents = config.modResults.contents.replace(
        /android\s*\{/,
        `android {${splitBlock}`
      );
    }
    return config;
  });
};

module.exports = withSplitApk;
