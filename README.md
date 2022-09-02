gcfunc
======

A google cloud function to handle uploads of images by our team and assign the
images to businesses.

Deploying
---------
```
gcloud functions deploy function-1 \
  --runtime nodejs16 \
  --trigger-resource saidong \j
  --trigger-event google.storage.object.finalize \
  --project saigonbros

gcloud functions deploy helloGCS \
  --runtime nodejs16 \
  --trigger-resource saidong \
  --trigger-event google.storage.object.finalize \
  --project saigonbros \
  --set-secrets '/tmp/secrets=googleapis:latest' \
  --set-secrets 'NEO4J_URI=neo4j-uri:latest' \
  --set-secrets 'NEO4J_USERNAME=neo4j-username:latest' \
  --set-secrets 'NEO4J_PASSWORD=neo4j-password:latest' \
  --entry-point helloGCS
```

Secrets
-------
```
# create a secret
echo -n "my super secret data" | gcloud secrets create my-secret \
  --replication-policy="automatic" \
  --data-file=- \
  --project saigonbros

# bind permissions to secret
gcloud secrets add-iam-policy-binding projects/*********/secrets/neo4j-password \
    --member="serviceAccount:saigonbros@appspot.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor";

# add to project
# https://cloud.google.com/functions/docs/configuring/secrets#gcloud
gcloud functions deploy FUNCTION_NAME \
  --runtime RUNTIME \
  --set-secrets 'ENV_VAR_NAME=SECRET:VERSION' \
  --project saigonbros
```

Logs
----
```
gcloud functions logs read NAME --project saigonbros --limit 50 | vim # <- suggested dumping into vim
```
