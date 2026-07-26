---
source: https://www.hellointerview.com/learn/system-design/problem-breakdowns/distributed-rate-limiter
title: "Rate Limiter"
fetched_at: 2026-07-21T04:53:14.797Z
---

# Rate Limiter

![Microsoft](/_next/static/media/microsoft.42hyl5w3z8hlv.svg?dpl=2628d76d31240a170aeb5306d8b67ec8e5e4c9cc)

---

Watch the author walk through the problem step-by-step

Watch the author walk through the problem step-by-step

## Understanding the Problem

> **Note:** 🚦 What is a Rate Limiter? A rate limiter controls how many requests a client can make within a specific timeframe. It acts like a traffic controller for your API - allowing, for example, 100 requests per minute from a user, then rejecting excess requests with an HTTP 429 "Too Many Requests" response. Rate limiters prevent abuse, protect your servers from being overwhelmed by bursts of traffic, and ensure fair usage across all users.

### Functional Requirements

For this breakdown, we'll design a request-level rate limiter for a social media platform's API. This means we're limiting individual HTTP requests (like posting tweets, fetching timelines, or uploading photos) rather than higher-level actions or business operations. We'll focus on a server-side implementation that controls traffic and protects our systems. While client-side rate limiting has value as a complementary approach (which we'll discuss later), server-side rate limiting is essential for security and system protection since clients can't be trusted to self-regulate.

Core Requirements

- The system should identify clients by user ID, IP address, or API key to apply appropriate limits.
- The system should limit HTTP requests based on configurable rules (e.g., 100 API requests per minute per user).
- When limits are exceeded, the system should reject requests with HTTP 429 and include helpful headers (rate limit remaining, reset time).
Below the line (out of scope)

- Complex querying or analytics on rate limit data
- Long-term persistence of rate limiting data
What are the non-functional requirements?

![image](/assets/learn/gp-inline-board-preview.webp)

Try it yourself first

We recommend you to practice the question yourself first to get instant personalized feedback as you go.

### Non-Functional Requirements

At this point, you should ask your interviewer about scale expectations. Are we building this for a startup API with thousands of requests per day, or for a major platform handling millions of requests per second? The scale will completely change our design choices.

We'll assume we're designing for a substantial but realistic load: 1 million requests per second across 100 million daily active users.

Core Requirements

- The system should introduce minimal latency overhead (< 10ms per request check).
- The system should be highly available. Eventual consistency is ok as slight delays in limit enforcement across nodes are acceptable.
- The system should handle 1M requests/second across 100M daily active users.
Below the line (out of scope)

- Strong consistency guarantees across all nodes
Here is how this might look on the whiteboard in an interview:

Requirements

## The Set Up

### Planning the Approach

For a problem like this, you need to show flexibility when choosing the right path through the Hello Interview Delivery Framework. In fact, this is a famous question that is asked very differently by different interviewers at different companies. Some are looking for more low-level design, even code in some instances. Others are more focused on how the system should be architected and scaled.

In this breakdown, we'll follow the most common path (and the one I take when I ask this question) where we balance algorithm selection with high-level distributed system design that can handle the expected load.

I'll cover the simple set of core entities and system interface, then focus most of our time on rate limiting algorithms and scaling challenges - that's where the real design decisions happen.

### Defining the Core Entities

While rate limiters might seem like simple infrastructure components, they actually involve several important entities that we need to model properly:

Rules: The rate limiting policies that define limits for different scenarios. Each rule specifies parameters like requests per time window, which clients it applies to, and what endpoints it covers. For example: "authenticated users get 1000 requests/hour" or "the search API allows 10 requests/minute per IP."

Clients: The entities being rate limited - this could be users (identified by user ID), IP addresses, API keys, or combinations thereof. Each client has associated rate limiting state that tracks their current usage against applicable rules.

Requests: The incoming API requests that need to be evaluated against rate limiting rules. Each request carries context like client identity, endpoint being accessed, and timestamp that determines which rules apply and how to track usage.

These entities work together: when a Request arrives, we identify the Client, look up applicable Rules, check current usage against those rules, and decide whether to allow or deny the request. The interaction between these entities powers our rate limiter.

### System Interface

A rate limiter is an infrastructure component that other services call to check if a request should be allowed. The interface is straightforward:

```
isRequestAllowed(clientId, ruleId) -> { passes: boolean, remaining: number, resetTime: timestamp }
```

This method takes a client identifier (user ID, IP address, or API key) and a rule identifier, then returns whether the request should be allowed based on current usage. It also provides information for response headers like X-RateLimit-Remaining and X-RateLimit-Reset.

## High-Level Design

We start by building an MVP that works to satisfy the core functional requirements. This doesn't need to scale or be perfect. It's just a foundation for us to build upon later. We will walk through each functional requirement, making sure each is satisfied by the high-level design.

### 1) The system should identify clients by user ID, IP address, or API key to apply appropriate limits

Before we can limit anyone, we need to make two key decisions. First, where should our rate limiter live in the architecture? This determines what information we have access to and how it integrates with the rest of our system. Second, how do we identify different clients so we can apply the right limits to the right users? These decisions are connected - your placement choice affects what client information you can easily access, and your identification strategy influences where the rate limiter makes sense to deploy.

Where should we place the rate limiter?

You have three main options here, each with different trade-offs:

Each application server or microservice has rate limiting built directly into the application code. When a request comes in, the server checks its local in-memory counters, updates them, and decides whether to allow or reject the request. This is really fast since everything happens in memory, no network calls, no external dependencies.

In-Process Rate Limiter

The main problem is that each server only knows about its own traffic, not the global picture. Say you want to limit users to 100 requests per minute. If you have 5 application servers behind a load balancer, and requests get distributed evenly, each server might see 20 requests per minute from a user and think "that's fine, well under 100." But globally, the user is actually making 100 requests per minute across all servers.

Even worse, if the load balancer changes how it routes traffic, or if one server gets more load than others, your limits become completely unpredictable. A user might get 100 requests through one server and 100 through another, for 200 total.

This approach only works if you have a single application server or if you're okay with approximate limits that can be off by a factor equal to your server count.

The rate limiter becomes its own microservice that sits between your clients and application servers. When a request arrives at an application server, the server first makes an API call to the rate limiting service: "Should I allow this request from user 12345?" The rate limiter checks its centralized counters and responds with either "yes, allow it" or "no, reject with 429."

This architecture gives you a lot more flexibility. Your application servers can provide rich context when making the rate limit check like user subscription tier, account status, the specific API endpoint being called, or even complex business logic like "allow extra requests during Black Friday." You can also have different rate limiting services for different parts of your system, each tuned for specific needs.

Most importantly, the rate limiting service maintains global state, so it can enforce precise limits across all your application servers. If you want 100 requests per minute globally, you get exactly that regardless of how many servers you have.

Dedicated Service Rate Limiter

The biggest downside is latency. Every single request to your system now requires an additional network round trip before it can be processed. Even if the rate limiter is fast (say 10ms), that's still 10ms added to every request. At scale, this adds up.

You've also introduced another point of failure. If your rate limiting service goes down, you need to decide: do you fail open (allow all requests through, risking overload) or fail closed (reject all requests, essentially taking your API offline)? Neither option is great.

There's operational complexity too. You now have another service to deploy, monitor, scale, and maintain. The rate limiting service itself needs to be highly available, which means you need redundancy, health checks, and probably some form of data replication.

Finally, you need to handle network issues gracefully. What if the rate limiter is slow to respond? Do you wait (adding more latency) or timeout and make a guess? What if there are network partitions between your app servers and the rate limiter?

The rate limiter runs at the very edge of your system, integrated into your API gateway or load balancer. Every incoming request hits the rate limiter first, before it reaches any of your application servers. The rate limiter examines the request (checking IP address, user authentication headers, API keys), applies the appropriate limits, and either forwards the request downstream or immediately returns an HTTP 429 response.

This is the most popular approach in production systems because it's conceptually simple and provides strong protection. Your application servers never see blocked requests, so they can focus entirely on processing legitimate traffic. For those who like analogies, the rate limiter acts like a bouncer at a club. Troublemakers get turned away at the door, not after they're already inside causing problems like was the case with our "Good" approach.

API Gateway Rate Limiter

The main limitation is context. The rate limiter only has access to information available in the HTTP request itself - headers, URL, IP address, and basic authentication tokens. It can't see deeper business logic or user context that might live in your application layer. For example, you can't easily implement rules like "premium users get 10x higher limits" unless that premium status is encoded in a JWT token or similar.

There's also the question of where to store the rate limiting state. The gateway needs fast access to counters and timestamps, which usually means an in-memory store like Redis. But now you have external dependencies and need to handle cases where Redis is slow or unavailable.

We'll talk all about how to do this effectively in our deep dives!
