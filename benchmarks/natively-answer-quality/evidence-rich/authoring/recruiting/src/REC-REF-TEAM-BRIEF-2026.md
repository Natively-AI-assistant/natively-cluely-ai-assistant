# Ingestion Platform: Team Brief for Candidates

Kestrelwick Systems | Data Platform group | Last updated 1 September 2026

Prepared by Idris Halvorsen-Peake, Director of Data Platform. Cleared by People Operations for sharing with candidates.

## Kestrelwick at a glance

- Founded in 2014 in Duluth, Minnesota. About 310 employees.
- Product: Coldline, a routing and temperature-compliance platform for refrigerated freight.
- Customers: 140 refrigerated carriers in the United States and Canada. Roughly 61,000 trailers report into the platform.
- Funding: a Series D round of $85 million closed in May 2025, led by Tamarack Ridge Partners.
- Offices: headquarters in Duluth and an engineering hub in Chattanooga, Tennessee.

## The Data Platform group

Data Platform is one of four engineering groups. It has three teams:

- Ingestion Platform, the team this role leads.
- Query Platform, led by Tobiah Raskovic, with 6 engineers. They own the APIs and dashboards that read what Ingestion stores.
- Device Gateway, led by Maribel Oyelaran-Fitch, with 5 engineers. They own the firmware-facing edge that trailers connect to.

## The Ingestion Platform team

The Engineering Lead has 4 direct reports: two senior engineers, one mid-level engineer and one associate engineer. The team is based in Duluth. One further senior engineer opening is approved for the first quarter of 2027.

The lead reports to Idris Halvorsen-Peake, Director of Data Platform. Idris reports to Yevgenia Marlowe-Okafor, VP of Engineering.

The role is open because the previous lead, Maribel Oyelaran-Fitch, moved across in July 2026 to start the Device Gateway team. She is still in the group and has offered to hand over in person.

## What the team runs

- Services are written in Go. Python is used for tooling and data-quality jobs.
- Apache Kafka, self-managed on Kubernetes, in three clusters.
- ClickHouse for time-series storage and PostgreSQL for metadata.
- AWS, with us-east-2 as the primary region. Terraform for infrastructure and Grafana for dashboards.

On a normal weekday the platform takes in about 1.9 billion messages. The peak is around 52,000 messages per second, during the afternoon dispatch window. The median delay from a trailer sending a reading to that reading being queryable is 4 seconds.

## Priorities for 2027

- Retire the legacy Sparrow batch importer by March 2027.
- Move Kafka to tiered storage, with a target of 30% lower storage spend.
- Stand up a second ingestion region, us-west-2, by the third quarter of 2027.

## How the team works

The team runs two-week sprints with planning on Mondays. Designs are written up and commented on in writing before anyone meets about them. Standup is at 9:30 Central. The team ships about 25 production deploys a week through an automated pipeline; anyone on the team can deploy. Friday afternoons are kept free of meetings.

Engineers at Kestrelwick are levelled from E1 to E7. This role is an E6.

## What recruiters may and may not share

Everything in this brief can be shared with candidates. Do not share revenue, runway, the value of any customer contract, or the names of customers that are not on the public customer page. If a candidate asks about those, say that the hiring manager can speak to the business in more depth at the next stage.
