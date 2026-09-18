// The filesystem catch-all is the single Vercel Function for every /api/*
// request.  `server.ts` owns the Express route table; keep endpoint routing out
// of Vercel rewrites so all HTTP methods reach that same application.
import handler from "../dist/server.cjs";

export default handler;
