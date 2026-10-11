# EcoGraph API Examples

Base URL: `http://localhost:8080`

## Health check
```bash
curl http://localhost:8080/health
```

## Full graph
```bash
curl http://localhost:8080/graph
```

## Route (priority mode)
```bash
curl -X POST http://localhost:8080/route \
  -H "Content-Type: application/json" \
  -d '{"homeIds": ["H1", "H3"], "mode": "priority"}'
```

## Hazardous route
```bash
curl -X POST http://localhost:8080/route/hazard \
  -H "Content-Type: application/json" \
  -d '{"locationId": "HZ1"}'
```

## Classify waste
```bash
curl -X POST http://localhost:8080/classify \
  -H "Content-Type: application/json" \
  -d '{"description": "used chemical syringe"}'
```

## Advance simulation
```bash
curl -X POST http://localhost:8080/simulate/advance \
  -H "Content-Type: application/json" \
  -d '{"days": 3, "autoCollect": true}'
```

## Reset simulation
```bash
curl -X POST http://localhost:8080/simulate/reset
```
