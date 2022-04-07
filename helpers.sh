#!/bin/zsh

gcf_deploy () {
  gcloud functions deploy helloGCS \
    --runtime nodejs16 \
    --trigger-resource saidong \
    --trigger-event google.storage.object.finalize \
    --project saigonbros \
    --set-secrets '/etc/secrets/googleapis=googleapis:latest' \
    --set-secrets 'NEO4J_URI=neo4j-uri:latest' \
    --set-secrets 'NEO4J_USERNAME=neo4j-username:latest' \
    --set-secrets 'NEO4J_PASSWORD=neo4j-password:latest' \
    --entry-point helloGCS
}
