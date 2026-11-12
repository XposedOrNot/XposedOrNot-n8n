# n8n-nodes-xposedornot

This is an n8n community node. It lets you use XposedOrNot in your n8n workflows.

XposedOrNot is a data breach lookup service. With this node you can check whether an email address appears in known data breaches, read the details of each breach, and watch your company or client domains for new exposure.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

[Installation](#installation)
[Operations](#operations)
[Credentials](#credentials)
[Compatibility](#compatibility)
[Usage](#usage)
[Example workflows](#example-workflows)
[Rate limits](#rate-limits)
[Privacy](#privacy)
[Resources](#resources)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation. The package name is `n8n-nodes-xposedornot`.

## Operations

### Email

- **Check Breaches**: returns whether an email address appears in known breaches, and which ones.
- **Get Analytics**: returns a fuller picture for one address: its breaches, breaches by year, password strength and a risk summary.

### Breach

- **Get**: returns the details of a single breach by its ID.
- **Get Many**: returns the breaches in the XposedOrNot catalog with their date, size and the kinds of data exposed. Can be filtered by domain.

### Domain

- **Get Breaches**: returns the breached addresses on the domains verified for your Community API key.

### xonPlus Domain

- **Create**: submits a new domain for validation.
- **Get Exposures**: returns the breached addresses on one of your onboarded domains, one item per address and breach. Can return only what is new since a given time.
- **Get Many**: returns the domains on your account and their status.
- **Get Quota**: returns how many domain slots you have used and how many are left.
- **Get Summary**: returns the breach summary for one of your onboarded domains. Can cover only what is new since a given time.

### XposedOrNot Trigger (xonPlus)

- **New breach exposure for my domains**: starts a workflow when an address on one of your onboarded domains appears in a breach newly added to XposedOrNot. The first run sets the starting point and sends nothing, so you are not flooded with history. A domain you add later starts the same way.

## Credentials

The two Email operations and the two Breach operations work without an API key.

For everything else, add an **XposedOrNot API** credential:

1. Choose the **Key Type**: **Community** (a free key from [xposedornot.com](https://xposedornot.com)) or **xonPlus** (a key from your [xonPlus](https://plus.xposedornot.com) account).
2. Paste the **API Key**.
3. Select **Test** to confirm it works.

The Domain operation needs a Community key. The xonPlus Domain operations and the trigger need a xonPlus key. With a xonPlus key selected, **Check Breaches** uses the xonPlus email endpoint.

## Compatibility

Tested with n8n 2.47.5.

## Usage

- **Check Breaches** always returns one item per email address, with `breached` set to true or false, the list of `breaches` and a `breach_count`. An address with no breaches is a normal result, not an error, so you can loop over a list without extra error handling.
- **Simplify** is on by default on the operations with large responses and returns a short result. Turn it off to get the full API response.
- Operations that return many rows have **Return All** and **Limit**.
- In the trigger, **Domain Names or IDs** limits the watch to the domains you choose. Leave it empty to watch every approved domain on your account.
- Testing the trigger in the editor returns a small sample of existing exposure so you can build the rest of the workflow. It does not change the starting point.
- The node can be used as a tool by n8n AI agents.

## Example workflows

Both workflows are in the [`examples`](https://github.com/XposedOrNot/XposedOrNot-n8n/tree/main/examples) folder. Import a file in n8n with **Import from File**, then add your own credentials and channel or project.

### Check every new signup email for breaches

[`signup-breach-check.json`](https://github.com/XposedOrNot/XposedOrNot-n8n/blob/main/examples/signup-breach-check.json)

Webhook (new signup) → XposedOrNot (Email: Check Breaches) → IF (`breached` is true) → Slack (tell the security channel).

Use it to spot accounts that start life with exposed credentials. Swap the Slack step for a call to your own app if you would rather ask the user to set a fresh password.

### Open a ticket when a client domain appears in a new breach

[`domain-exposure-ticket.json`](https://github.com/XposedOrNot/XposedOrNot-n8n/blob/main/examples/domain-exposure-ticket.json)

XposedOrNot Trigger (New breach exposure for my domains) → Summarize (group by domain) → Jira (one ticket per domain, listing the affected addresses and the breaches).

Use it if you look after several client domains and want each new exposure to land in the queue your team already works from.

## Rate limits

The free API is rate limited per IP address, and workflows that loop over lists reach the limit quickly. When the limit is reached, the node waits and retries if the API says how long to wait and the wait is a minute or less. Otherwise it stops with a clear message.

For higher limits, see [xonAPI+](https://plus.xposedornot.com/products/api).

## Privacy

The node sends only what the operation needs (an email address or a domain) to the XposedOrNot API over HTTPS. Breach exposure tied to an email address is personal information. Use it only for addresses and domains you are allowed to check.

Privacy policy: https://xposedornot.com/privacy

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [XposedOrNot API documentation](https://api.xposedornot.com/docs)
- [xonPlus API documentation](https://plus-api.xposedornot.com/docs)
- Support: help@xposedornot.com

## License

[MIT](LICENSE)
