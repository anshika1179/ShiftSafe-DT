import {NextRequest,NextResponse} from "next/server";
import {authorizeWorker} from "@/lib/server/authorization";
import {activateSandbox,sandboxSnapshot,scenarioEvent,checkSandboxWeather,settleSandbox,SandboxError} from "@/backend/services/sandbox";
import {consumeRateLimit} from "@/lib/server/rate-limit";
export async function GET(req:NextRequest){const auth=await authorizeWorker(req);if(auth.response)return auth.response;return NextResponse.json(await sandboxSnapshot(auth.workerId),{headers:{"Cache-Control":"no-store"}});}
export async function POST(req:NextRequest){
 if(req.headers.get("origin")!==req.nextUrl.origin)return NextResponse.json({error:"Invalid sandbox origin"},{status:403});
 const auth=await authorizeWorker(req);if(auth.response)return auth.response;
 try{const body=await req.json();if(body.workerId&&body.workerId!==auth.workerId)return NextResponse.json({error:"Worker mismatch"},{status:403});
 const identity=auth.workerId;
 switch(body.action){
 case "activate":if(body.confirmNoMoney!==true)throw new SandboxError("Confirm this is simulated premium only, no money or insurance",400);await activateSandbox(identity);break;
 case "scenario":if(body.confirmSimulation!==true)throw new SandboxError("Confirm synthetic scenario",400);await scenarioEvent(identity,String(body.policyId),body.peril,body.evidenceCase);break;
 case "weather":if(!consumeRateLimit(`sandbox-weather:${identity}`,6,3600000).allowed)throw new SandboxError("Weather check limit reached. Try later.",429);return NextResponse.json(await checkSandboxWeather(identity,String(body.policyId)));
 case "settle":await settleSandbox(identity,String(body.claimId));break;
 default:throw new SandboxError("Unknown sandbox action",400);
 }
 return NextResponse.json(await sandboxSnapshot(identity));
 }catch(e){if(e instanceof SandboxError)return NextResponse.json({error:e.message,financialEffect:false},{status:e.status});console.error("Sandbox action failed",e);return NextResponse.json({error:"Sandbox action failed. Reload before retrying the same action.",financialEffect:false},{status:500});}
}
