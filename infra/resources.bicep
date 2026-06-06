// Gloss resources — resource-group scope.
// Log Analytics + Container Apps Environment + ACR + a user-assigned identity
// (with AcrPull) + the single Container App that serves the SPA and the API.

@description('Location for all resources.')
param location string

@description('Stable token used to make resource names unique.')
param resourceToken string

@description('Tags applied to every resource.')
param tags object

param glossOauthClientId string
@secure()
param glossOauthClientSecret string
param glossBaseUrl string
param webImageName string

var placeholderImage = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
var image = empty(webImageName) ? placeholderImage : webImageName

// --- observability ---
resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-${resourceToken}'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

// --- container registry ---
resource registry 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' = {
  name: 'acr${resourceToken}'
  location: location
  tags: tags
  sku: { name: 'Basic' }
  properties: {
    adminUserEnabled: false
  }
}

// --- identity the container app uses to pull from ACR ---
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-${resourceToken}'
  location: location
  tags: tags
}

var acrPullRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')

resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, identity.id, acrPullRoleId)
  scope: registry
  properties: {
    roleDefinitionId: acrPullRoleId
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// --- container apps environment ---
resource containerEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'cae-${resourceToken}'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
}

// --- the app ---
resource web 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'ca-web-${resourceToken}'
  location: location
  tags: union(tags, { 'azd-service-name': 'web' })
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${identity.id}': {} }
  }
  properties: {
    managedEnvironmentId: containerEnv.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 8787
        transport: 'auto'
        allowInsecure: false
      }
      registries: [
        {
          server: registry.properties.loginServer
          identity: identity.id
        }
      ]
      secrets: [
        {
          name: 'gloss-oauth-client-secret'
          value: glossOauthClientSecret
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'web'
          image: image
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            { name: 'PORT', value: '8787' }
            { name: 'GLOSS_OAUTH_SCOPE', value: 'repo' }
            { name: 'GLOSS_OAUTH_CLIENT_ID', value: glossOauthClientId }
            { name: 'GLOSS_OAUTH_CLIENT_SECRET', secretRef: 'gloss-oauth-client-secret' }
            { name: 'GLOSS_BASE_URL', value: glossBaseUrl }
          ]
        }
      ]
      // In-memory sessions → pin to a single replica for now.
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
}

output AZURE_CONTAINER_REGISTRY_ENDPOINT string = registry.properties.loginServer
output AZURE_CONTAINER_REGISTRY_NAME string = registry.name
output SERVICE_WEB_URI string = 'https://${web.properties.configuration.ingress.fqdn}'
