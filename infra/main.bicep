// Gloss infrastructure — subscription scope.
// Creates the resource group and delegates all resources to resources.bicep.
targetScope = 'subscription'

@minLength(1)
@maxLength(64)
@description('Name of the azd environment — used to derive resource names.')
param environmentName string

@minLength(1)
@description('Primary location for all resources.')
param location string

@description('GitHub OAuth app client id.')
param glossOauthClientId string = ''

@secure()
@description('GitHub OAuth app client secret.')
param glossOauthClientSecret string = ''

@description('Public HTTPS base URL of the app (set after first deploy to the ACA FQDN). Drives the OAuth callback and the Secure cookie.')
param glossBaseUrl string = ''

@description('Container image for the web service. azd populates this after building; empty uses a placeholder on first provision.')
param webImageName string = ''

var resourceToken = toLower(uniqueString(subscription().id, environmentName, location))
var tags = { 'azd-env-name': environmentName }

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: 'rg-${environmentName}'
  location: location
  tags: tags
}

module resources 'resources.bicep' = {
  name: 'resources'
  scope: rg
  params: {
    location: location
    resourceToken: resourceToken
    tags: tags
    glossOauthClientId: glossOauthClientId
    glossOauthClientSecret: glossOauthClientSecret
    glossBaseUrl: glossBaseUrl
    webImageName: webImageName
  }
}

output AZURE_LOCATION string = location
output AZURE_TENANT_ID string = tenant().tenantId
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = resources.outputs.AZURE_CONTAINER_REGISTRY_ENDPOINT
output AZURE_CONTAINER_REGISTRY_NAME string = resources.outputs.AZURE_CONTAINER_REGISTRY_NAME
output SERVICE_WEB_URI string = resources.outputs.SERVICE_WEB_URI
