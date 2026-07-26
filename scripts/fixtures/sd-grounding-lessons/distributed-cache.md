---
source: https://www.hellointerview.com/learn/system-design/problem-breakdowns/distributed-cache
title: "Distributed Cache"
fetched_at: 2026-07-21T04:53:13.399Z
---

# Distributed Cache

![Google](/_next/static/media/google-square.2p5sdisco8gfq.svg?dpl=2628d76d31240a170aeb5306d8b67ec8e5e4c9cc)

![Microsoft](/_next/static/media/microsoft.42hyl5w3z8hlv.svg?dpl=2628d76d31240a170aeb5306d8b67ec8e5e4c9cc)

![Amazon](/_next/static/media/amazon-icon.2lvwf_3t3zas2.svg?dpl=2628d76d31240a170aeb5306d8b67ec8e5e4c9cc)

---

## Understanding the Problem

> **Note:** 💾 What is a Distributed Cache? A distributed cache is a system that stores data as key-value pairs in memory across multiple machines in a network. Unlike single-node caches that are limited by the resources of one machine, distributed caches scale horizontally across many nodes to handle massive workloads. The cache cluster works together to partition and replicate data, ensuring high availability and fault tolerance when individual nodes fail.

### Functional Requirements

Core Requirements

- Users should be able to set, get, and delete key-value pairs.
- Users should be able to configure the expiration time for key-value pairs.
- Data should be evicted according to Least Recently Used (LRU) policy.
Below the line (out of scope)

- Users should be able to configure the cache size.
> **Note:** We opted for an LRU eviction policy, but you'll want to ask your interviewer what they're looking for if they weren't explicitly upfront. There are, of course, other eviction policies you could implement, like LFU, FIFO, and custom policies.

What are the non-functional requirements of the system?

![image](/assets/learn/gp-inline-board-preview.webp)

Try it yourself first

We recommend you to practice the question yourself first to get instant personalized feedback as you go.

### Non-Functional Requirements

At this point in the interview, you should ask the interviewer what sort of scale we are expecting. This will have a big impact on your design, starting with how you define the non-functional requirements.

If I were your interviewer, I would say we need to store up to 1TB of data and expect to handle a peak of up to 100k requests per second.

Core Requirements

- The system should be highly available. Eventual consistency is acceptable.
- The system should support low latency operations (< 10ms for get and set requests).
- The system should be scalable to support the expected 1TB of data and 100k requests per second.
Below the line (out of scope)

- Durability (data persistence across restarts)
- Strong consistency guarantees
- Complex querying capabilities
- Transaction support
> **Note:** Note that I'm making quite a few strong assumptions about what we care about here. Make sure you're confirming this with your interviewer. Chances are you've used a cache before, so you know the plethora of potential trade-offs. Some interviewers might care about durability, for example, just ask.

## The Set Up

### Planning the Approach

### Defining the Core Entities

### The API

## High-Level Design

### 1) Users should be able to set, get, and delete key-value pairs

### 2) Users should be able to configure the expiration time for key-value pairs

### 3) Data should be evicted according to LRU policy

## Potential Deep Dives

### 1) How do we ensure our cache is highly available and fault tolerant?

### 2) How do we ensure our cache is scalable?

### 3) How can we ensure an even distribution of keys across our nodes?

### 4) What happens if you have a hot key that is being read from a lot?

### 5) What happens if you have a hot key that is being written to a lot?

### 6) How do we ensure our cache is performant?

## Tying it all together

## What is Expected at Each Level?

### Mid-level

### Senior

### Staff

### Purchase Premium to Keep Reading
