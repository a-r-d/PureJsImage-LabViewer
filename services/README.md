# Future service boundary

No backend is implemented in the initial skeleton.

A future service may be open source and Dockerized, hosted/proprietary, or both. The browser client should depend on stable contracts rather than service ownership.

Potential responsibilities:

- durable project storage and links;
- dataset registry and object-store locators;
- signed URL/token exchange;
- asynchronous compute jobs;
- team identity and permissions;
- plugin registry;
- audit/compliance features.

The service must not be required for:

- opening local files;
- direct compatible HTTP Range sources;
- viewing and basic analysis;
- local projects;
- BYOK OpenRouter agent use.

Do not add server code here until one real client workflow requires it. At that point create an architecture decision record and implement against interfaces in `packages/contracts`.
