import { NextResponse } from "next/server";
export async function POST(req: Request) {
try {
const { from, to, data, value } = await req.json();
const response = await fetch(
[
"tenderly.co",
process.env.TENDERLY_USER,
"project",
process.env.TENDERLY_PROJECT,
"simulate",
].join("/"),
{
method: "POST",
headers: {
"Content-Type": "application/json",
"X-Access-Key": process.env.TENDERLY_ACCESS_KEY!,
},
body: JSON.stringify({
network_id: "8453",
from,
to,
input: data,
value: value || "0",
save: false,
save_if_fails: true,
simulation_type: "quick",
}),
}
);
const sim = await response.json();
if (!sim.transaction?.status) {
return NextResponse.json(
{ success: false, error: sim.transaction?.error_message || "Simulation reverted" },
{ status: 400 }
);
}
const assetChanges =
sim.transaction.transaction_info?.asset_changes?.map((change: any) => ({
type: change.type,
tokenSymbol: change.token_info?.symbol || "TOKEN",
amount: change.amount,
from: change.from,
to: change.to,
})) || [];
return NextResponse.json({
success: true,
gasUsed: sim.transaction.gas_used,
assetChanges,
});
} catch (err: any) {
return NextResponse.json(
{ success: false, error: err.message || "Simulation request failed" },
{ status: 500 }
);
}
}
