import {
  acceptPartial, cancelOrder, cancelTender, confirmProposal, confirmReceipt, createTender, director, findSupply, markDelivered,
  markPickedUp, operatorApproveListing, operatorApproveRecovery, operatorRejectListing, rateFarmer, retryRecovery, type TenderInput,
} from '@/lib/flows';
import { roleOf } from '@/lib/access';

export const dynamic = 'force-dynamic';

// Presenter actions that finish quickly are awaited, so the CLI (reset, rehearse) knows when they are done.
// The scripted farmer replies (A, S, C) take a few seconds and run in the background.
const QUICK = new Set(['reset', 'offline', 'aiMode', 'channel', 'voice', 'demoData', 'thursday', 'elsenFallback']);

// One endpoint for every button in the Buyer and Operator views and the presenter keys.
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Record<string, string | number | undefined> & { tender?: TenderInput };
  try {
    switch (b.action) {
      case 'createTender':
        try { return Response.json({ tenderId: createTender(b.tender ?? ({} as TenderInput)) }); }
        catch (err) { return Response.json({ error: (err as Error).message }, { status: 400 }); }
      case 'cancelTender': cancelTender(String(b.tenderId)); break;
      case 'findSupply': await findSupply(String(b.tenderId)); break;
      case 'markPickedUp': markPickedUp(String(b.orderId)); break;
      case 'markDelivered': markDelivered(String(b.orderId)); break;
      case 'retryRecovery': retryRecovery(String(b.orderId)); break;
      case 'acceptPartial': acceptPartial(String(b.orderId)); break;
      case 'cancelOrder': cancelOrder(String(b.orderId)); break;
      case 'confirmProposal': return Response.json({ orderId: confirmProposal(String(b.proposalId)) });
      case 'approveRecovery': operatorApproveRecovery(String(b.orderId), b.candidate === undefined ? undefined : Number(b.candidate)); break;
      case 'confirmReceipt': confirmReceipt(String(b.orderId)); break;
      case 'rateFarmer': rateFarmer(String(b.orderId), String(b.farmerId), Math.max(1, Math.min(5, Number(b.stars) || 5))); break;
      case 'approveListing': operatorApproveListing(String(b.listingId)); break;
      case 'rejectListing': operatorRejectListing(String(b.listingId)); break;
      case 'director': {
        // Presenter controls (reset, modes, time skip, scripted farmers) need the presenter token.
        if (roleOf(req).kind !== 'admin') return Response.json({ error: 'presenter only' }, { status: 403 });
        const op = String(b.op);
        const p = director(op, b.arg === undefined ? undefined : String(b.arg));
        if (QUICK.has(op)) await p;
        else p.catch((err) => console.error('director failed', op, err));
        break;
      }
      default: return Response.json({ error: 'unknown action' }, { status: 400 });
    }
    return Response.json({ ok: true });
  } catch (err) {
    console.error(err);
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
