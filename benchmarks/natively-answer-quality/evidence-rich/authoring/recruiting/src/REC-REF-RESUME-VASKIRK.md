# Ottoline Vaskirk

Madison, Wisconsin | ottoline.vaskirk@mailhaven.example | 608-555-0143

## Summary

Engineering lead with ten years in backend and data infrastructure, the last six of them in freight telemetry. I build and run streaming pipelines, and the teams that operate them. I like work where a late message has a real cost and where the people on call are the people who wrote the code.

## Experience

### Halcyard Freight Cloud, Madison, WI

**Engineering Team Lead, Telemetry Pipeline** | March 2023 to present

- Lead and line-manage a team of 5 engineers responsible for ingesting sensor data from 22,000 trucks and trailers.
- Contributed to the migration of the event backbone from RabbitMQ to Kafka, a 9-engineer program led by the platform architect; owned the consumer-side cutover for 14 services with no customer-facing downtime.
- Reduced p99 ingestion latency from 4.2 s to 900 ms by redesigning partition keys and introducing micro-batching in the Go consumers.
- Cut pipeline infrastructure spend by 23% ($410K annualized) through tiered retention and right-sizing brokers.
- Incident commander for 6 Sev-1 incidents across 2024 and 2025; introduced blameless post-incident reviews for the department.
- Hired 3 engineers and supported one promotion to senior engineer.
- Pipeline peak throughput: 38,000 messages per second.

**Senior Software Engineer** | June 2020 to February 2023

- Built the change data capture pipeline from PostgreSQL into Kafka using Debezium, feeding the Snowflake warehouse; 140 tables replicated.
- Wrote the Go client library that 11 internal services use to publish telemetry events.
- Mentored 2 junior engineers (no line responsibility).
- Took part in the telemetry pipeline on-call rotation, one week in four.

### Pindrop & Wren Analytics, Milwaukee, WI

**Software Engineer** | August 2016 to May 2020

- Developed Java services and nightly Spark batch jobs for retail sales analytics.
- Maintained the ETL scheduler and cut the nightly batch runtime from 7 hours to 3.5 hours.
- Member of a 12-person engineering group; rotated through the release-captain duty every sixth week.

## Education

B.S. Computer Science, University of Wisconsin-Eau Claire, 2016

## Skills

- Languages: Go, Java, Python, SQL
- Streaming and data: Kafka, RabbitMQ, Debezium, Spark, PostgreSQL, Snowflake
- Infrastructure: Kubernetes, Terraform, AWS

## Certifications and talks

- AWS Certified Solutions Architect - Associate, 2021
- "Cutting over 14 consumers without a maintenance window", Midwest Data Infrastructure Meetup, 2024

## Outside work

Volunteer mentor with the Madison chapter of Code Lantern, a weekend programme that teaches programming to high-school students. Organiser of a monthly streaming-systems reading group of about 30 people. Amateur ice-boat sailor on Lake Mendota in the cold months.
