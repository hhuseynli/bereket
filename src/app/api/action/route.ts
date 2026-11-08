import {
  confirmProposal, confirmReceipt, director, findSupply, operatorApproveListing, operatorApproveRecovery,
  operatorRejectListing, rateFarmer,
} from '@/lib/flows';

export const dynamic = 'force-dynamic';

// One endpoint for every button in the Buyer and Operator views and the presenter keys.
export async function POST(req: Request) {
  const b = (await req.json()) as Record<string, string | number | undefined>;
  try {
    switch (b.action) {
      case 'findSupply': await findSupply(String(b.tenderId)); break;
      case 'confirmProposal': return Response.json({ orderId: confirmProposal(String(b.proposalId)) });
      case 'approveRecovery': operatorApproveRecovery(String(b.orderId), b.candidate === undefined ? undefined : Number(b.candidate)); break;
      case 'confirmReceipt': confirmReceipt(String(b.orderId)); break;
      case 'rateFarmer': rateFarmer(String(b.orderId), String(b.farmerId), Number(b.stars)); break;
      case 'approveListing': operatorApproveListing(String(b.listingId)); break;
      case 'rejectListing': operatorRejectListing(String(b.listingId)); break;
      case 'director': void director(String(b.op), b.arg === undefined ? undefined : String(b.arg)); break;
      default: return Response.json({ error: 'unknown action' }, { status: 400 });
    }
    return Response.json({ ok: true });
  } catch (err) {
    console.error(err);
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
