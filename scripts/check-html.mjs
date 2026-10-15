// Fails if the inline <script> code in index.html has a syntax error (run before deploying the app).
import {readFileSync} from "node:fs";
const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const code=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join("\n;\n");
try{new Function(code);console.log("index.html scripts: syntax OK");}
catch(e){console.error("index.html scripts: "+e.message);process.exit(1);}
