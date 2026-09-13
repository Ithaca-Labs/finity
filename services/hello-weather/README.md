# hello-weather@1

Fixed-price x402 provider: 0.05 HBAR per `GET /weather` call.

`GET /weather?city=<city>` geocodes the requested city and reads current
temperature and WMO weather code from Open-Meteo. No API key is required.

The exported manifest is unsigned fixture metadata. A deployment must supply a
real provider signer, Hedera account, receipt key, and facilitator before
starting the Express app.
