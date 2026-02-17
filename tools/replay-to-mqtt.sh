#!/bin/bash
# Replay trigger events from replay-test-04 to devices/02abcad5add4/events/trigger
# Usage: bash replay-to-mqtt.sh

MQTT_HOST="127.0.0.1"
MQTT_PORT="1883"
DEVICE_ID="02abcad5add4"
TOPIC="devices/${DEVICE_ID}/events/trigger"

echo "Replaying triggers to ${TOPIC}..."

docker exec ebus-mongo mongosh --quiet -u admin -p ebus2026 --authenticationDatabase admin ebus --eval '
db.triggers.find({deviceId: "replay-test-04"}).sort({timestamp:1}).forEach(r => {
  var msg = JSON.stringify({
    sm: r.sm,
    trigger: r.trigger,
    timestamp: r.timestamp,
    arg: r.arg || {},
    e: r.e
  });
  print(msg);
})' | while IFS= read -r payload; do
  echo "  -> $(echo "$payload" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("e","?"))')"
  docker exec ebus-mosquitto mosquitto_pub -h localhost -p 1883 -t "$TOPIC" -m "$payload"
  sleep 0.1
done

echo "Done! Replayed all triggers."
