Contributing
============

Thanks for contributing. Quick notes:

- Set up your environment variables locally by copying `.env.example` to `.env`.
- Run `npm install` in the `server/` folder to install server dependencies.
- The project supports two deployment modes:
  - Vercel Serverless (`api/proxy.js` + static site)
  - Express server (`server/index.js`) for an always-on service

To run locally:

```powershell
cd f:\SHL\server
npm install
node index.js
```

Make sure to set `DEMO_PROXY=1` for demo mode if you don't want to configure an API key.
