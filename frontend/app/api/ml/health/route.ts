import {NextResponse} from "next/server";
export async function GET(){return NextResponse.json({status:"unavailable",trainedModel:false,dataset:null,accuracy:null,confidence:null,reason:"No documented worker-loss/claims training dataset or holdout evaluation. Sandbox checks are rules, not trained fraud prediction."},{headers:{"Cache-Control":"no-store"}});}
