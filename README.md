# n8n-nodes-ktemia

An [n8n](https://n8n.io/) community node for [Ktemia](https://www.ktemia.com), the travel search API. Compare live flight, hotel, and rental car prices across 100+ providers from any n8n workflow, or give an n8n AI Agent the node as a tool.

Ktemia searches and compares. It does not book, take payment, or hold reservations. Every price comes with a link to the provider's own site, where the booking happens.

[Installation](#installation) · [Credentials](#credentials) · [Operations](#operations) · [Usage](#usage) · [Quota and limits](#quota-and-limits) · [Errors](#errors) · [Resources](#resources)

## Installation

In n8n, open **Settings > Community Nodes**, select **Install**, and enter:

```
n8n-nodes-ktemia
```

See the n8n [community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) for self-hosted setups.

## Credentials

1. Create a free API key at [app.ktemia.com/api-keys](https://app.ktemia.com/api-keys). The Free plan includes 100 requests a month and needs no card.
2. In n8n, add a **Ktemia API** credential and paste the key.

n8n tests the credential with `GET /key`, the one Ktemia endpoint that never counts against your quota, so saving it is free.

The key is sent as the `X-API-Key` header to `https://api.ktemia.com` only. The node does not follow redirects, so the key never goes to another host.

## Operations

| Resource | Operation | What it does | Requests |
|---|---|---|---|
| Lookup | Find Airport or City | IATA codes for flight searches, such as `LHR`, or `LON` for every London airport | 1 |
| Lookup | Find Airline | Two-letter airline codes, such as `DL` | 1 |
| Lookup | Find Hotel Location | The location ID a hotel search needs | 1 |
| Lookup | Find Car Rental Location | The location ID a car search needs | 1 |
| Flight | Search | One way, round trip, or multi-city (2 to 6 flights) | 2 |
| Flight | Get Next Page | More results of an earlier search | 1 per page |
| Flight | Get Details | Every seller's price, booking link, and bag fees for one flight | 1 |
| Hotel | Search | Hotels and other stays, with stars, rating, and amenity filters | 2 |
| Hotel | Get Next Page | More results of an earlier search | 1 per page |
| Hotel | Get Details | Every seller's price and booking link for one hotel | 1 |
| Hotel | Get Reviews | Guest reviews from Booking.com, Agoda, and Priceline, 10 per page | 1 |
| Car | Search | Rental cars at any city or airport | 2 |
| Car | Get Next Page | More results of an earlier search | 1 per page |
| Car | Get Details | Every seller's price and booking link for one car | 1 |
| Account | Get Key Status | Plan, rate limits, and requests left this month | free |

### How searches work

A search starts on Ktemia, then the node reads the first page of results. That is two requests. The output holds the results plus two tokens:

- `searchToken`: the token of the page a result came from. **Get Details** needs it together with the result's `id`.
- `nextToken`: pass it to **Get Next Page** for more results. A page without one is the last page.

Tokens expire 60 minutes after the search starts.

**Return All** keeps reading pages until there are none left or **Limit** results are read. Each page is one request, so keep Limit low on the Free plan.

**Split Into Items** (on by default) outputs one n8n item per result. Turn it off to get whole pages, including `totalResults` and `availableFilters`. The filters list the provider, agency, and amenity IDs that the Providers, Agencies, and Amenities fields accept.

### Things to know

- **Codes and IDs, not names.** Flight searches take IATA airport or city codes. Hotel and car searches take a location ID. Get them with a Lookup operation first. A place name is rejected.
- **Country sets the currency.** There is no currency field. Set Country (for example `GB`) to search that market in its currency. Leave it out for the US and USD.
- **Dates cannot be in the past.** The node checks dates, codes, and counts before calling the API, so a typo fails without spending quota.
- **Only the fields you set are sent.** Ktemia rejects unknown fields, and the node never fills in defaults on your behalf.
- **Results are passed through unchanged**, including every `providerUrl`.

## Usage

### Cheapest nonstop fares, every morning

1. **Schedule Trigger**: every day at 08:00.
2. **Ktemia**: Flight > Search. Trip Type `One Way`, Origin `JFK`, Destination `LAX`, Departure Date in two weeks. Additional Fields: Max Stops `Nonstop Only`, Sort By `Price`.
3. **Limit**: keep the first 3 items.
4. **Slack**: post `{{ $json.bookingOptions[0].formattedPrice }}` and the departure times.

Two requests a day, about 60 a month: inside the Free plan.

### A hotel shortlist with reviews

1. **Ktemia**: Lookup > Find Hotel Location, Query `Lisbon`.
2. **Ktemia**: Hotel > Search, Location ID `{{ $json.locationId }}`, check-in and check-out dates, Additional Fields: Min Guest Rating `8+`, Free Cancellation Only.
3. **Ktemia**: Hotel > Get Reviews for the top results, Contains Text `noise`.

### Rental cars at an airport

1. **Ktemia**: Lookup > Find Car Rental Location, Query `AUS`, Location Type `Airport`.
2. **Ktemia**: Car > Search, Pickup Location ID `{{ $json.locationId }}`, pickup and drop-off dates, Additional Fields: Car Class `SUV`.
3. **Ktemia**: Car > Get Details, Search Token `{{ $json.searchToken }}`, Result ID `{{ $json.id }}`, for every seller and booking link.

### As an AI Agent tool

The node is usable as a tool, so an n8n **AI Agent** can look up codes and run searches itself. Every call spends quota, so tell the agent to ask for missing trip details rather than guess them.

## Quota and limits

Every request except Get Key Status counts against the account's monthly quota. Every key on an account shares that quota.

| Plan | Requests a month | Per second |
|---|---|---|
| Free | 100 | 2 |
| Pro | 20,000 | 20 |
| Business | 750,000 | 250 |

See [pricing](https://www.ktemia.com/pricing/). Run **Account > Get Key Status** at any time to see what is left and when it resets.

## Errors

Errors show Ktemia's stable error code and message, for example `INVALID_ORIGIN: ...`, plus what to fix.

| Code | What the node does |
|---|---|
| `RATE_LIMIT_EXCEEDED` | Waits for `Retry-After` and retries, up to 3 times |
| `QUOTA_EXCEEDED` | Fails at once and never retries: the month's requests are used up |
| `SEARCH_FAILED`, `DETAILS_FAILED`, `UPSTREAM_ERROR`, other 5xx | Retries once, then fails |
| `NO_RESULTS` | Not a failure: outputs no items and shows a note |
| `NO_MORE_RESULTS` | Ends paging quietly |
| `SEARCH_EXPIRED` | Fails: the token is over 60 minutes old, so run the search again |
| `MISSING_API_KEY`, `INVALID_API_KEY` | Fails and points to the credential |
| Input errors such as `MISSING_FIELD` or `INVALID_LOCATION` | Fails and names the field |

The node supports n8n's **Continue On Fail** setting. A failed item then outputs `{ error, code }` instead of stopping the workflow.

## Compatibility

Built with `@n8n/node-cli` 0.57 against `n8n-workflow` 2.48, and tested in n8n 2.x.

## Development

```bash
npm install
npm run dev            # n8n at http://localhost:5678 with this node loaded
npm run lint
npm test               # build, then unit tests with mocked HTTP
npm run test:contract  # check fields and options against the live OpenAPI spec
KTEMIA_API_KEY=... node scripts/live-check.js  # real API, about 17 requests
```

## Learn more

- [Best Travel API in 2026: Access and Coverage](https://www.ktemia.com/blog/best-travel-api/)
- [Flight Search API: Compare Fares for a Route](https://www.ktemia.com/blog/flight-search-api/)
- [Hotel Price API: Every Booking Site in One Call](https://www.ktemia.com/blog/hotel-price-api/)
- [Car Rental API: Compare Vehicles](https://www.ktemia.com/blog/car-rental-api/)
- [How to Add a Flights MCP in Cursor or Claude](https://www.ktemia.com/blog/flights-mcp/)
- [More on the Ktemia blog](https://www.ktemia.com/blog/)

## Resources

- [Ktemia API documentation](https://www.ktemia.com/docs/api/)
- [OpenAPI spec](https://www.ktemia.com/openapi.json)
- [Ktemia MCP server](https://github.com/Ktemiaa/ktemia-mcp), for Claude, ChatGPT, Cursor, and other MCP clients
- [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)

## License

[MIT](LICENSE)
