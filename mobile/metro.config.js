// Config Metro d'Expo + identifiants de débogage Sentry (source maps des plantages).
const { getSentryExpoConfig } = require('@sentry/react-native/metro')

module.exports = getSentryExpoConfig(__dirname)
