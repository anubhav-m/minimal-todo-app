const { withAppBuildGradle } = require('@expo/config-plugins');

const withSplitApk = (config) => {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.language === 'groovy') {
      config.modResults.contents = config.modResults.contents.replace(
        /def enableSeparateBuildPerCPUArchitecture = false/g,
        'def enableSeparateBuildPerCPUArchitecture = true'
      );
    }
    return config;
  });
};

module.exports = withSplitApk;
