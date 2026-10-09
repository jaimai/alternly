// Vérifie que chaque module natif installé (même indirectement) a la version attendue
// par le SDK Expo (node_modules/expo/bundledNativeModules.json). Un écart compile, mais
// plante sur le téléphone : Expo Go et les builds embarquent le code natif de ces versions.
// Ex. : expo-router tirait react-native-reanimated 4.7.1 alors que le SDK 57 attend 4.5.1.
const fs = require('fs')
const path = require('path')
const semver = require('semver')

const root = path.join(__dirname, '..')
const expected = require(path.join(root, 'node_modules/expo/bundledNativeModules.json'))
const problems = []

for (const [name, range] of Object.entries(expected)) {
  let version
  try {
    version = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8')).version
  } catch {
    continue // module non installé : rien à vérifier
  }
  if (!semver.satisfies(version, range)) problems.push(`${name} ${version} (attendu par le SDK : ${range})`)
}

if (problems.length) {
  console.error('Modules natifs incompatibles avec le SDK Expo :\n  ' + problems.join('\n  '))
  console.error('Corriger avec : EXPO_OFFLINE=1 npx expo install <paquet>')
  process.exit(1)
}
console.log('Modules natifs alignés sur le SDK Expo.')
