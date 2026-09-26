// The ladder. L5 is the hardest (read pixels AND reason/compute from them);
// L1 is the gist of the screen. Every answer is machine-checkable, and every
// ground truth was verified by hand against the screenshot before it was used.
//
// `checks` entries are either a regex or {num, target, tol} for a numeric answer
// read out of the model's text (first number within tolerance counts).
import { near, onLine } from './scoring.mjs'

export const LEVELS = [
  {
    level: 7,
    name: 'Pixel-precise alignment, counting and tiny text',
    why: 'Where vision models classically break: holding a row across 5 columns, counting small glyphs exactly, and reading 11px text.',
    tasks: [
      {
        id: 'row_alignment', shot: 'dense_table',
        q: 'This is a 26-row table. Answer tersely, numbered, one value per line: (1) the SKU on row 19, (2) the region on row 19, (3) the units on row 19, (4) the margin percentage on row 19, (5) the SKU on row 7.',
        checks: {
          sku19: onLine(1, /SKU-1180/i),
          region19: onLine(2, /APAC/i),
          units19: onLine(3, /1[,.]?242/),
          margin19: onLine(4, /11\.6/),
          sku7: onLine(5, /SKU-1060/i),
        },
      },
      {
        id: 'glyph_counting', shot: 'ci_matrix',
        q: 'This is a CI checks list. Answer tersely, numbered, one value per line: (1) how many jobs failed, (2) how many were skipped, (3) how many passed, (4) name every failed job.',
        checks: {
          failed_count: onLine(1, near(5, 0)),
          skipped_count: onLine(2, near(3, 0)),
          passed_count: onLine(3, near(16, 0)),
          failed_named_webkit: onLine(4, /webkit/i),
          failed_named_windows: onLine(4, /windows/i),
          failed_named_docker: onLine(4, /docker.*arm64|arm64/i),
        },
      },
      {
        id: 'tiny_log', shot: 'log_tiny',
        q: 'This is a log viewer. Answer tersely, numbered, one value per line: (1) the line number of the only ERROR line, (2) the order id in it, (3) the attempt number in it, (4) the component that logged it.',
        checks: {
          line_23: onLine(1, near(23, 0)),
          order_id: onLine(2, /8f3c21ab/i),
          attempt: onLine(3, near(3, 0)),
          component: onLine(4, /billing\.worker/i),
        },
      },
    ],
  },
  {
    level: 6,
    name: 'Cross-screenshot diagnosis and exhaustive scanning',
    why: 'Two screenshots that only mean something together, and a scan that must not miss or invent a row.',
    tasks: [
      {
        id: 'diff_causes_failure', shots: ['pr_diff', 'pr_failure'],
        q: 'Screenshot 1 is a pull request diff; screenshot 2 is the failing test from that pull request. Answer tersely, numbered, one per line: (1) which changed line causes the failure, quoting it, (2) what it should be instead, (3) what the test expected and what it got.',
        checks: {
          quotes_added_line: onLine(1, /Date\.now\(\)\s*-\s*at/),
          correct_fix: onLine(2, /at\s*-\s*Date\.now\(\)/),
          expected_actual: onLine(3, /5000/),
        },
      },
      {
        id: 'exhaustive_scan', shot: 'dense_table',
        q: 'This is a 26-row table with a Status column. Answer tersely, numbered, one per line: (1) how many rows have status "review", (2) the row numbers of every one of them, (3) the total number of rows in the table.',
        checks: {
          review_count: onLine(1, near(6, 0)),
          rows_listed: onLine(2, /\b1\b[^0-9]{0,6}6\b[^0-9]{0,6}11\b[^0-9]{0,6}16\b[^0-9]{0,6}21\b[^0-9]{0,6}26\b/),
          total_rows: onLine(3, near(26, 0)),
        },
      },
    ],
  },
  {
    level: 5,
    name: 'Reason and compute from the screen',
    why: 'The live-copilot case: the answer is not written anywhere on screen. Requires reading small text or chart geometry AND doing the work.',
    tasks: [
      {
        id: 'code_bug', shot: 'code_bug',
        q: 'This is a Java file and the JUnit output for it. Answer tersely, numbered: (1) which line number contains the bug, (2) the exact corrected code for that line, (3) why the failing test fails, (4) name one variable that is assigned but never used.',
        checks: {
          line_12: onLine(1, /\b(line\s*)?12\b/),
          fix: onLine(2, /lo\s*<=\s*hi/),
          why_last_element: onLine(3, /last|hi\b|lo\s*==\s*hi|never (checked|examined|compared)|skip/i),
          dead_var: onLine(4, /guard/i),
        },
      },
      {
        id: 'chart_read', shot: 'chart_nolabels',
        q: 'This bar chart has no printed data labels. Answer tersely, numbered: (1) the approximate value for Thursday, (2) which day is lowest, (3) how many days are above 100, (4) the approximate sum of Saturday and Sunday.',
        checks: {
          thursday: onLine(1, near(155, 12)),
          lowest_wed: onLine(2, /wed/i),
          above_100_is_3: onLine(3, /(^|[^0-9])3([^0-9]|$)|three/i),
          weekend_sum: onLine(4, near(207, 22)),
        },
      },
      {
        id: 'financial_math', shot: 'stock_financials',
        q: 'This is a stock financials page. Answer tersely, numbered: (1) the latest revenue figure shown on the chart, (2) the latest net income figure, (3) net income as a percentage of revenue for that latest year, (4) which months the fiscal year runs between.',
        checks: {
          revenue: onLine(1, near(466.8, 1.5)),
          net_income: onLine(2, near(128.9, 1.5)),
          margin: onLine(3, near(27.6, 2.0)),
          fiscal_year: onLine(4, /october\s*[-–to]+\s*september/i),
        },
      },
    ],
  },
  {
    level: 4,
    name: 'Precise dense extraction',
    why: 'Values are on screen, but small, numerous and easy to confuse with a neighbouring cell or row.',
    tasks: [
      {
        id: 'table_lookup', shot: 'wikipedia_table',
        q: 'This is a GDP table. Answer tersely, numbered: (1) the country at rank 11 and its IMF value, (2) the IMF value for Switzerland, (3) the year in the World Bank column header, (4) what the World Bank and United Nations cells contain for Taiwan.',
        checks: {
          canada: onLine(1, /canada/i),
          canada_value: onLine(1, /2[,.]?507[,.]?340/),
          swiss: onLine(2, /1[,.]?146[,.]?911/),
          wb_year: onLine(3, /2025/),
          taiwan_blank: onLine(4, /—|–|--|\bdash\b|no data|not available|empty|blank|n\/a/i),
        },
      },
      {
        id: 'tiny_code', shot: 'github_code_small',
        q: 'This is a file on GitHub, rendered small. Answer tersely, numbered: (1) the repository and file path, (2) the branch name shown, (3) how many lines the file has, (4) the module required on line 15.',
        checks: {
          repo_path: onLine(1, /express.*lib\/utils\.js|lib\/utils\.js/is),
          branch: onLine(2, /master/i),
          lines: onLine(3, /271/),
          require: onLine(4, /node:http/i),
        },
      },
      {
        id: 'feed_counts', shot: 'hn_frontpage',
        q: 'This is the Hacker News front page. Answer tersely, numbered: (1) the title of story 1 with its points and comment count, (2) the title of story 3, (3) the domain shown for story 4.',
        checks: {
          s1: onLine(1, /fujitsu/i),
          s1_points: onLine(1, /343/),
          s1_comments: onLine(1, /132/),
          s3: onLine(2, /gitlab/i),
          s4_domain: onLine(3, /crowdsec/i),
        },
      },
    ],
  },
  {
    level: 3,
    name: 'UI state judgement',
    why: 'Not text extraction: which control is active, and whether the user is signed in. The failure mode seen in the earlier fallback test.',
    tasks: [
      {
        id: 'repo_state', shot: 'github_repo',
        q: 'Answer tersely, numbered: (1) is a user signed in to this site, yes or no, and what tells you, (2) which tab in the repository navigation is currently selected, (3) the star count.',
        checks: {
          not_signed_in: onLine(1, /\bno\b|not signed|signed out|sign in|log in/i),
          code_tab: onLine(2, /code/i),
          stars: onLine(3, /69\.?5\s*k/i),
        },
      },
      {
        id: 'dashboard_state', shot: 'grafana_home',
        q: 'Answer tersely, numbered: (1) the product name and the page title, (2) is a user signed in, yes or no, (3) which item in the left navigation is highlighted as active.',
        checks: {
          product: onLine(1, /grafana/i),
          not_signed_in: onLine(2, /\bno\b|not signed|signed out|sign in/i),
          nav_dashboards: onLine(3, /dashboard/i),
        },
      },
      {
        id: 'tabs_state', shot: 'stock_financials',
        q: 'Answer tersely, numbered: (1) in the horizontal tab row directly under the share price (Overview, Financials, Forecast, Statistics, ...), which tab is selected, (2) which of Annual, Quarterly or TTM is selected, (3) is the market open or closed, (4) the current price.',
        checks: {
          financials_tab: onLine(1, /financials/i),
          annual: onLine(2, /annual/i),
          market_open: onLine(3, /open/i),
          price: onLine(4, /335\.90/),
        },
      },
    ],
  },
  {
    level: 2,
    name: 'Plain extraction',
    why: 'Large, unambiguous text near the top of the screen.',
    tasks: [
      {
        id: 'repo_basics', shot: 'github_repo',
        q: 'Answer tersely, numbered: (1) the repository owner and name, (2) is the repository public or private, (3) the number of open issues shown.',
        checks: { repo: onLine(1, /expressjs\s*\/\s*express/i), public: onLine(2, /public/i), issues: onLine(3, /107/) },
      },
      {
        id: 'page_basics', shot: 'stock_financials',
        q: 'Answer tersely, numbered: (1) the company name and ticker, (2) the exchange, (3) the page section heading.',
        checks: { company: onLine(1, /apple/i), ticker: onLine(1, /AAPL/i), exchange: onLine(2, /nasdaq/i), heading: onLine(3, /financials/i) },
      },
    ],
  },
  {
    level: 1,
    name: 'Gist',
    why: 'Sanity floor: what am I looking at.',
    tasks: [
      {
        id: 'gist_hn', shot: 'hn_frontpage',
        q: 'Answer tersely, numbered: (1) what website is this, (2) what kind of page is it, (3) is the colour scheme light or dark.',
        checks: { site: onLine(1, /hacker news|ycombinator/i), kind: onLine(2, /news|link|story|forum|aggregat|front page/i), light: onLine(3, /light/i) },
      },
      {
        id: 'gist_code', shot: 'code_bug',
        q: 'Answer tersely, numbered: (1) what programming language is shown, (2) what is the panel at the bottom showing, (3) is the colour scheme light or dark.',
        checks: { java: onLine(1, /java/i), tests: onLine(2, /test|junit|fail/i), dark: onLine(3, /dark/i) },
      },
    ],
  },
]
