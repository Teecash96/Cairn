import { createPlan, type PlanInput } from './plan'

export const NIMIQ_TEMPLATE: PlanInput = {
  name: 'Meetup tickets',
  idea: 'A Nimiq mini app that lets community meetup organisers sell tickets in NIM and check guests in with a ticket code.',
  targetUser: 'Small community meetup organisers and their guests',
  problem: 'Organisers reconcile payments and guest lists manually.',
  goal: 'A guest pays once and receives a ticket; the organiser checks it in once.',
}

/** Curated illustration, never presented as generated output or customer evidence. */
export function createExamplePlan() {
  const plan = createPlan(NIMIQ_TEMPLATE, {
    summary: 'Sell a ticket in NIM, confirm payment, and give each guest a unique check-in code.',
    problem: NIMIQ_TEMPLATE.problem!,
    targetUser: NIMIQ_TEMPLATE.targetUser!,
    userGoal: NIMIQ_TEMPLATE.goal!,
    coreFeatures: ['Event details and ticket price', 'NIM checkout with payment confirmation', 'Unique ticket and organiser check-in'],
    userStories: ['As a guest, I can see the price before opening my wallet.', 'As a guest, I can recover my ticket after refreshing.', 'As an organiser, I can reject a ticket that has already been used.'],
    successCriteria: ['A confirmed payment issues exactly one ticket.', 'A guest can recover a purchased ticket.', 'A second check-in of the same ticket is rejected.'],
    assumptions: ['Illustrative plan: demand has not been validated.', 'The pilot uses one organiser and one event.'],
    outOfScope: ['Reserved seating', 'Ticket resale', 'Multiple ticket tiers'],
  }, [
    { kind: 'entry', title: 'Open event', action: 'Read the event details.', result: 'Date, location, availability, and NIM price are visible.' },
    { kind: 'action', title: 'Choose a ticket', action: 'Request one ticket.', result: 'The app creates an order with an expiry time.' },
    { kind: 'action', title: 'Approve payment', action: 'Review and approve the wallet payment.', result: 'The order shows payment pending.' },
    { kind: 'decision', title: 'Payment confirmed?', action: 'The server checks the payment for this order.', result: 'The order follows its verified payment state.', branches: [{ label: 'Yes', result: 'Issue one ticket for this order.' }, { label: 'Not yet', result: 'Keep the order pending and allow a status retry without paying again.' }] },
    { kind: 'success', title: 'Receive ticket', action: 'Save the ticket code.', result: 'The ticket can be recovered with the purchasing wallet.' },
    { kind: 'exit', title: 'Check in', action: 'Show the code to the organiser.', result: 'The organiser marks it used once.' },
  ], {
    mvpScope: ['One event with a fixed NIM ticket price', 'One ticket per confirmed order', 'Wallet-based ticket recovery and organiser check-in'],
    milestones: [
      { title: 'Validate the event', outcome: 'An organiser agrees to pilot the ticket flow.', tasks: ['Interview one organiser about payment reconciliation.', 'Define the event details, capacity, and cancellation policy.', 'Test the ticket screen with three prospective guests.'] },
      { title: 'Build checkout', outcome: 'A guest receives a ticket after a verified payment.', tasks: ['Create an order with a price, expiry, and unique payment reference.', 'Open NIM checkout and show pending or cancelled states.', 'Verify payment and issue a ticket exactly once.', 'Allow the purchasing wallet to recover its ticket.'] },
      { title: 'Run the pilot', outcome: 'The organiser checks in guests without duplicate admissions.', tasks: ['Restrict check-in access to the organiser.', 'Reject reused ticket codes.', 'Run a small pilot and record payment or check-in failures.'] },
    ],
    risks: ['A late payment needs an explicit fulfilment or refund policy.', 'Simultaneous purchases must not exceed event capacity.', 'Guests may need help setting up their first wallet.'],
    acceptanceTests: ['Submitting the same confirmed transaction twice produces only one ticket.', 'Cancelling checkout does not mark an order paid.', 'Refreshing after payment still allows ticket recovery.', 'Two simultaneous check-ins cannot both succeed for one ticket.'],
    nextAction: 'Interview one organiser about payment reconciliation.',
  }, [{ priority: 'high', concern: 'Unvalidated demand', why: 'An organiser may prefer their existing ticket service.', fix: 'Ask one organiser to try the complete flow before extending scope.' }])
  return plan
}
