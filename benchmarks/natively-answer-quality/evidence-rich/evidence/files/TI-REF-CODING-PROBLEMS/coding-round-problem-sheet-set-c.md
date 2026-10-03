# Coding round: problem sheet

Set C · revised 29 September 2026

The interviewer picks which problems you work on and in what order. Any mainstream language is fine. Keep each function name exactly as written here, whatever the language, because our runner calls it by name. Talk through your approach before you type, state the time and space complexity when you finish, and expect to be asked whether it can be done better.

Unless a problem says otherwise, input is plain ASCII and fits in memory.

## Problem 1: Palindrome with noise

Write `is_palindrome(s)`.

Return true if the string reads the same forwards and backwards once you skip every character that is not an ASCII letter or digit and ignore case. Digits count as characters. A string with nothing left after skipping, including the empty string, is a palindrome.

| Input | Output |
|---|---|
| "A man, a plan, a canal: Panama" | true |
| "race a car" | false |
| "No 'x' in Nixon" | true |
| "0P" | false |
| ".,;" | true |

Constraints: length from 0 to 200,000. Expected: linear time and constant extra space.

## Problem 2: Merge the bookings

Write `merge_intervals(intervals)`.

Each interval is a pair [start, end] of integers with start not after end. The input is in no particular order. Return the merged intervals sorted by start. Two intervals that overlap are merged, and so are two that only touch: [1, 4] and [4, 6] become [1, 6]. An empty input returns an empty list.

| Input | Output |
|---|---|
| [[1, 3], [2, 6], [8, 10], [15, 18]] | [[1, 6], [8, 10], [15, 18]] |
| [[1, 4], [4, 6]] | [[1, 6]] |
| [[5, 7], [1, 2]] | [[1, 2], [5, 7]] |

Constraints: up to 100,000 intervals, values between -1,000,000,000 and 1,000,000,000. Expected: O(n log n) time.

## Problem 3: Most frequent words

Write `top_k_words(words, k)`.

Given a list of lowercase words and an integer k, return the k most frequent words, most frequent first. Words with the same count are ordered alphabetically. k is at least 1 and never more than the number of distinct words.

| Input | Output |
|---|---|
| ["tea", "ice", "tea", "jam", "ice", "tea"], k = 2 | ["tea", "ice"] |
| ["pear", "apple", "pear", "apple", "fig"], k = 2 | ["apple", "pear"] |
| ["kiwi"], k = 1 | ["kiwi"] |

Constraints: up to 500,000 words, each 1 to 20 letters. Expected: better than sorting every distinct word when k is small, that is O(n log k).

## Problem 4: Sliding-window limiter

Write `allowed_requests(timestamps, limit, window)`.

`timestamps` is a list of request times in milliseconds, in non-decreasing order. A request at time t is allowed if fewer than `limit` earlier allowed requests have a timestamp greater than t minus `window`. Rejected requests do not count against later ones. Return a list of booleans, one per request.

| Input | Output |
|---|---|
| timestamps = [0, 100, 200, 900, 1000, 1100], limit = 3, window = 1000 | [true, true, true, false, true, true] |
| timestamps = [5, 5, 5], limit = 2, window = 10 | [true, true, false] |
| timestamps = [], limit = 1, window = 1 | [] |

Constraints: up to 1,000,000 timestamps, limit from 1 to 10,000, window from 1 to 86,400,000. Expected: linear time, and extra space proportional to limit, not to the number of requests.

## What we look at

Correctness on the tables above and on edge cases you find yourself, a clear statement of complexity, and how you respond when asked to improve the first version. We do not mark down for syntax slips.
