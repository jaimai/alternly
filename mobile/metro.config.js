// Sentry : identifiants de débogage dans les bundles pour relier les source maps.
const { getSentryExpoConfig } = require('@sentry/react-native/metro')

module.exports = getSentryExpoConfig(__dirname)
