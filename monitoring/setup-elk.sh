#!/bin/bash
echo "Setting up Elasticsearch ILM policy for 30-day retention..."
curl -X PUT "http://localhost:9200/_ilm/policy/filebeat-retention" -H 'Content-Type: application/json' -d'
{
  "policy": {
    "phases": {
      "hot": {
        "actions": {
          "rollover": {
            "max_age": "1d",
            "max_size": "50gb"
          }
        }
      },
      "delete": {
        "min_age": "30d",
        "actions": {
          "delete": {}
        }
      }
    }
  }
}
'

echo "Setting up Kibana Alert for ERROR logs > 10/min for 5 min..."
# Requires Kibana Alerting API (or Watcher in ES)
# In a real environment, you would use the Kibana Saved Objects API to import the dashboards and alerts.
