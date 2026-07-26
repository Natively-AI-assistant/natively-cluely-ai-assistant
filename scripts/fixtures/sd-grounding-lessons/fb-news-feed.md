---
source: https://www.hellointerview.com/learn/system-design/problem-breakdowns/fb-news-feed
title: "FB News Feed"
fetched_at: 2026-07-21T04:53:18.979Z
---

# FB News Feed

---

Watch the author walk through the problem step-by-step

Watch the author walk through the problem step-by-step

## Understanding the Problem

> **Note:** 📰 What is Facebook's News Feed Facebook is a social network which pioneered the News Feed, a product which shows recent stories from users in your social graph.

This is a classic system design problem dealing with fan-out and data management. For this problem, let's assume we're handling uni-directional "follow" relationships as opposed to the bi-directional "friend" relationships which were more important for the earliest versions of Facebook.

Let's start by defining our requirements.

### Functional Requirements

Core Requirements

- Users should be able to create posts.
- Users should be able to friend/follow people.
- Users should be able to view a feed of posts from people they follow, in reverse chronological order (newest first).
- Users should be able to page through their feed.
Below the line (out of scope):

- Users should be able to like and comment on posts.
- Posts can be private or have restricted visibility.
For the sake of this problem (and most system design problems for what it's worth), we can assume that users are already authenticated and that we have their user ID stored in the session or JWT.

What are the non-functional requirements for this system?

![image](/assets/learn/gp-inline-board-preview.webp)

Try it yourself first

We recommend you to practice the question yourself first to get instant personalized feedback as you go.

### Non-Functional Requirements

Core Requirements

- The system should be highly available (prioritizing availability over consistency). We'll tolerate up to 1 minute of post staleness (eventual consistency).
- Posting and viewing the feed should be fast, returning in < 500ms.
- The system should be able to handle a massive number of users (2B).
- Users should be able to follow an unlimited number of users, users should be able to be followed by an unlimited number of users.
> **Note:** Having quantities on your non-functional requirements will help you make decisions during your design. A system which is single-digit millisecond fast requires a dramatically different architecture than a "fast" system which can take a second to respond.

Here's how it might look on your whiteboard:

Facebook News Feed Requirements

## The Set Up

### Planning the Approach

The hard part of this design is going to be dealing with the potential of users who are following a massive number of people, or people with lots of followers (a problem known as "fan out"). We'll want to move quickly to satisfy the base requirements so we can dive deep there. For this problem (like many!), following our functional requirements in order provides a natural structure to the interview, so we'll do that.

### Defining the Core Entities

Starting with core entities gives us a set of terms to use through the rest of the interview. This also helps us to understand the data model we'll need to support the functional requirements later.

For the News Feed, the primary entities are easy. We'll make an explicit entity for the link between users:

- User: A user in our system.
- Follow: A uni-directional link between users in our system.
- Post: A post made by a user in our system. Posts can be made by any user, and are shown in the feed of users who follow the poster.
In the actual interview, this can be as simple as a short list like this. Just make sure you talk through the entities with your interviewer to ensure you are on the same page.

Core Entities

### API or System Interface

The API is the primary interface that users will interact with. It's important to define the API early on, as it will guide your high-level design. We can build our API by defining the endpoints necessary for each of our functional requirements.

For our first requirement, we need to create posts:

```
POST /posts 
{
    "content": { }
}
// -> 200 OK
{
    "postId": // ...
}
```

We'll leave the content empty to account for rich content or other structured data we might want to include in the post. For authentication, we'll tell our interviewer that authentication tokens are included in the header of the request and avoid going into too much detail there unless requested.

Moving on, we need to be able to follow people. Let's use a simple RESTFUL PUT endpoint for this. The authenticated user (from their JWT) is the one doing the following, and [id] is the user they want to follow.

```
PUT /users/[id]/follow
{ }
// -> 200 OK
```

Here the follow action is binary. By using PUT we can ensure it is idempotent so it doesn't fail if the user clicks follow twice. Unfollowing (out of scope) would be accomplished with a DELETE. We don't need a body but we'll include a stub just in case and keep moving.

Our last requirement is to be able to view our feed and page through it.

```
GET /feed?pageSize={size}&cursor={timestamp?}
{
    items: Post[],
    nextCursor: string
}
```

This can be a simple GET request. We've included some parameters to allow the user to page through their feed. Since our requirements are to return posts in reverse chronological order, when users page through their feed they'll be looking at increasingly older posts. We'll use a timestamp as a "cursor" to represent the oldest post they've seen so far, so each page will return N posts older than that timestamp.

We'll avoid diving into the structure of Posts for the moment to give ourselves time for the juicier parts of the interview.

> **Note:** Especially for more senior candidates, it's important to focus your efforts on the "interesting" aspects of the interview. Spending too much time on obvious elements both deprives you of time for the more interesting parts of the interview but also signals to the interviewer that you may not be able to distinguish more complex pieces from trivial ones: a critical skill for senior engineers. "I'll come back if I have time for this" is a great strategy!

Ok, we now have some API's, let's work on building the high-level design behind them.

## High-Level Design

### 1. Users should be able to create posts.

In our first requirement, we need to create posts and have them accessible by their ID. We're going to start very basic here and build up complexity as we go.

To start, and since we know this is going to scale, we'll put a horizontally scaled service behind an API gateway/load balancer. We can skip the caching aspect since we'll get to that later. By having the API gateway and load balancer, we can scale up our service with more traffic by adding additional hosts. Since each host is stateless as it's only writing to the database (and we're not dealing with reads yet), this is really easy to scale by just adding more hosts!

Users hit our API gateway with a new post request, this gets passed to one of the post service endpoints which creates an insert event that is sent to our database. Easy.

Simple Post Creation

For our database, we can use any key-value store. For this application, let's use DynamoDB for its simplicity and scalability. DynamoDB allows us to provision extremely high throughput provided we spread our load evenly across our partitions.

Great, we can create posts. Onward.

### 2. Users should be able to friend/follow people.

Functionally, following or friending a person is establishing a relationship between two users. This is a many-to-many relationship, and we can model it as a graph. Typically, for a graph you'll use a purpose-built graph database (like Neo4j) or a triple store. However, for our purposes, we can use a simple key-value store and model the graph ourselves.

> **Note:** Graph databases can be more useful when you need to do traversals or comprehensions of a graph. This usually requires stepping between different nodes, like capturing the friends of your friends or creating an embedding for a recommendation system. We only have simple requirements in this problem so we'll keep our system simple and save ourselves from scarier questions like "how do you scale Neo4j?" We don't need a full-fledged graph database for this problem.

To do this, we'll have a simple Follow table using the entire relation with userFollowing as the partition key and userFollowed as the sort key. We can also create a Global Secondary Index (GSI) with the reverse relationship (e.g. partition key of userFollowed and sort key of userFollowing) to allow us to look up all the followers of a given user.

This allows us to query for the important pieces:

- If we want to check if the user is following another user, we query with both the partition key and the sort key (e.g. userFollowing:userFollowed). This is a simple lookup!
- If we want to get all the users a given user is following, we query with the partition key (e.g. userFollowing). This is a range query.
- If we want to get all the users who are following a given user, we query the GSI with its partition key (e.g. userFollowed). This is a range query.
We can put this data in another DynamoDB table for simplicity. In practice, AWS recommends single-table design for DynamoDB, but using separate tables here keeps our discussion clearer and is totally fine for an interview.

Following Service

We're off to a good start. Let's keep going.

### 3. Users should be able to view a feed of posts from people they follow.

The challenge of viewing a feed of posts can be broken down into steps, which we can do with our present design with only a few changes:

- First, we get all of the users who a given user is following.
- Next, we get all of the posts from those users.
- Finally, we sort all those posts by time and return them to the user.
We'll start by adding a feed service to do this work. It's going to be read-heavy and have very different query patterns than the Post and Follow services, so separating it out makes sense.

News feed generation is quintessentially read-intensive - users check their feeds constantly but post rarely. This makes scaling reads essential through pre-computing feeds for active users, caching recent posts from followed users, and smart pagination. The key is that users typically only read the first few items, so aggressive caching of recent content delivers massive performance gains.

Finding all the posts from a given user is tricky with the existing Posts table: while we have an index on our follow table to quickly look up all the users a user is following, we don't have an index on our post table to quickly look up all the posts from a set of users. We can solve this by adding a GSI to the Post table with the creatorID as the partition key and the post's creation timestamp createdAt as the sort key. This will allow us to quickly pull all the posts from a set of users in chronological order.

Naive Feed Service

That seems to work. For a given user, we first request all of the users they follow from the Follow table. Then we request all the posts from those N users from the Post table via its GSI. Then we sort all of those posts by timestamp and return the results to the user!

Now alarm bells may be ringing for you and that's good. Several flags emerge here and your interviewer is going to expect you to see them quickly, so it's good to note them verbally:

- Our user may be following lots of users.
- Each of those users may have lots of posts.
- The total set of posts may be very large because of (1) or (2).
We'll need to solve those before we wrap things up! But before we dive into these complexities let's polish off our functional requirements.
