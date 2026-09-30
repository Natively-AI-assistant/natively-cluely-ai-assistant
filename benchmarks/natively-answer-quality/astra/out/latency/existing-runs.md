## aq2-dev-cur vs aq2-dev-fix6
| mode | run | n | err | ref needles all-in-prompt | validators pass | epistemic | src-exposure | coaching | meta | words | TTFT p50/p95 | total p50/p95 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| call-center | aq2-dev-cur | 40 | 0 | 7/7 | - | 5 | 0 | 0 | 0 | 58 | 941/2312 | 1223/2343 |
| call-center | aq2-dev-fix6 | 40 | 0 | 7/7 | - | 1 | 0 | 0 | 0 | 59 | 800/1140 | 1984/2770 |
| general | aq2-dev-cur | 40 | 0 | 7/7 | 1/1 | 2 | 0 | 0 | 0 | 45 | 839/1253 | 1259/1817 |
| general | aq2-dev-fix6 | 40 | 0 | 7/7 | 1/1 | 1 | 0 | 0 | 0 | 46 | 778/1147 | 1265/1957 |
| lecture | aq2-dev-cur | 40 | 0 | 8/8 | - | 1 | 0 | 0 | 0 | 91 | 897/1313 | 1595/2403 |
| lecture | aq2-dev-fix6 | 40 | 0 | 8/8 | - | 1 | 0 | 0 | 0 | 90 | 725/1262 | 1334/1923 |
| looking-for-work | aq2-dev-cur | 40 | 0 | 3/6 | - | 3 | 1 | 0 | 0 | 63 | 1376/2045 | 1823/2579 |
| looking-for-work | aq2-dev-fix6 | 40 | 0 | 5/6 | - | 0 | 1 | 0 | 0 | 55 | 1109/1539 | 2429/3101 |
| recruiting | aq2-dev-cur | 40 | 0 | 8/10 | - | 5 | 2 | 8 | 0 | 54 | 906/1221 | 1239/1784 |
| recruiting | aq2-dev-fix6 | 40 | 0 | 8/10 | - | 1 | 3 | 0 | 0 | 49 | 758/1106 | 1020/1639 |
| sales | aq2-dev-cur | 40 | 0 | 10/10 | 1/3 | 5 | 0 | 0 | 0 | 61 | 957/1725 | 1313/2447 |
| sales | aq2-dev-fix6 | 40 | 0 | 10/10 | 3/3 | 1 | 0 | 0 | 0 | 56 | 785/1075 | 2004/3348 |
| seminar | aq2-dev-cur | 40 | 0 | 23/23 | 2/2 | 1 | 0 | 0 | 0 | 62 | 1252/1622 | 1728/3872 |
| seminar | aq2-dev-fix6 | 40 | 0 | 23/23 | 2/2 | 3 | 0 | 0 | 0 | 62 | 867/1084 | 1352/2873 |
| team-meet | aq2-dev-cur | 40 | 0 | 7/7 | 1/1 | 6 | 0 | 0 | 0 | 54 | 946/2026 | 1330/2239 |
| team-meet | aq2-dev-fix6 | 40 | 0 | 7/7 | 0/1 | 3 | 0 | 0 | 0 | 51 | 870/1154 | 1192/1562 |
| technical-interview | aq2-dev-cur | 40 | 0 | 3/8 | 0/2 | 3 | 1 | 0 | 0 | 95 | 1082/3557 | 1851/4014 |
| technical-interview | aq2-dev-fix6 | 40 | 0 | 8/8 | 2/2 | 0 | 1 | 0 | 0 | 95 | 1028/1522 | 1832/2747 |
| ALL | aq2-dev-cur | 360 | 0 | 76/86 | 5/9 | 31 | 4 | 8 | 0 | 65 | 990/2020 | 1495/2828 |
| ALL | aq2-dev-fix6 | 360 | 0 | 83/86 | 8/9 | 11 | 5 | 0 | 0 | 63 | 854/1337 | 1555/2753 |

## aq-holdout-fix2 vs aq2-holdout-fix6
| mode | run | n | err | ref needles all-in-prompt | validators pass | epistemic | src-exposure | coaching | meta | words | TTFT p50/p95 | total p50/p95 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| call-center | aq-holdout-fix2 | 30 | 0 | 8/8 | - | 3 | 0 | 0 | 0 | 59 | 970/1300 | 1297/1809 |
| call-center | aq2-holdout-fix6 | 30 | 0 | 8/8 | - | 3 | 0 | 0 | 0 | 58 | 765/1028 | 1765/3214 |
| general | aq-holdout-fix2 | 30 | 0 | 5/5 | - | 0 | 0 | 0 | 0 | 51 | 858/1132 | 1268/1660 |
| general | aq2-holdout-fix6 | 30 | 0 | 5/5 | - | 0 | 0 | 0 | 0 | 51 | 713/978 | 1076/1551 |
| lecture | aq-holdout-fix2 | 30 | 0 | 5/5 | - | 1 | 0 | 0 | 0 | 84 | 818/1077 | 1439/1891 |
| lecture | aq2-holdout-fix6 | 30 | 0 | 5/5 | - | 1 | 0 | 0 | 0 | 96 | 730/1048 | 1375/2311 |
| looking-for-work | aq-holdout-fix2 | 30 | 0 | 2/5 | - | 3 | 1 | 0 | 0 | 70 | 1205/2098 | 1573/2618 |
| looking-for-work | aq2-holdout-fix6 | 30 | 0 | 4/5 | - | 0 | 1 | 0 | 0 | 66 | 914/1520 | 2191/2917 |
| recruiting | aq-holdout-fix2 | 30 | 0 | 5/5 | - | 3 | 0 | 7 | 0 | 54 | 1042/1794 | 1493/2397 |
| recruiting | aq2-holdout-fix6 | 30 | 0 | 5/5 | - | 2 | 0 | 0 | 0 | 49 | 737/985 | 1049/1301 |
| sales | aq-holdout-fix2 | 30 | 0 | 6/6 | 1/1 | 0 | 0 | 0 | 0 | 62 | 909/1406 | 1318/1947 |
| sales | aq2-holdout-fix6 | 30 | 0 | 6/6 | 1/1 | 0 | 0 | 1 | 1 | 59 | 742/1252 | 2009/3320 |
| seminar | aq-holdout-fix2 | 30 | 0 | 16/19 | 1/1 | 3 | 0 | 0 | 0 | 75 | 948/1342 | 1551/3303 |
| seminar | aq2-holdout-fix6 | 30 | 0 | 19/19 | 1/1 | 2 | 0 | 0 | 0 | 77 | 820/1048 | 1332/3193 |
| team-meet | aq-holdout-fix2 | 30 | 0 | 7/7 | - | 3 | 0 | 0 | 0 | 55 | 1018/1603 | 1477/1820 |
| team-meet | aq2-holdout-fix6 | 30 | 0 | 7/7 | - | 0 | 0 | 0 | 0 | 58 | 750/981 | 1088/1585 |
| technical-interview | aq-holdout-fix2 | 30 | 0 | 4/4 | - | 1 | 0 | 0 | 0 | 93 | 1067/1860 | 1890/2643 |
| technical-interview | aq2-holdout-fix6 | 30 | 0 | 4/4 | - | 0 | 0 | 0 | 0 | 101 | 1081/1523 | 1787/2654 |
| ALL | aq-holdout-fix2 | 270 | 0 | 58/64 | 2/2 | 17 | 1 | 7 | 0 | 67 | 964/1648 | 1438/2607 |
| ALL | aq2-holdout-fix6 | 270 | 0 | 63/64 | 2/2 | 8 | 1 | 1 | 1 | 68 | 778/1360 | 1483/2805 |

## aq-final-fix2 vs aq2-final-fix6
| mode | run | n | err | ref needles all-in-prompt | validators pass | epistemic | src-exposure | coaching | meta | words | TTFT p50/p95 | total p50/p95 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| call-center | aq-final-fix2 | 116 | 0 | 19/20 | 1/2 | 11 | 0 | 2 | 0 | 52 | 807/1307 | 1062/1555 |
| call-center | aq2-final-fix6 | 116 | 0 | 20/20 | 2/2 | 6 | 0 | 2 | 0 | 53 | 750/1302 | 1715/2760 |
| general | aq-final-fix2 | 110 | 0 | 18/21 | 3/5 | 7 | 0 | 1 | 0 | 49 | 809/1303 | 1164/1620 |
| general | aq2-final-fix6 | 110 | 0 | 21/21 | 5/5 | 6 | 0 | 0 | 1 | 50 | 675/1111 | 1051/1868 |
| lecture | aq-final-fix2 | 116 | 0 | 16/18 | 2/3 | 7 | 0 | 1 | 0 | 74 | 824/1215 | 1382/1950 |
| lecture | aq2-final-fix6 | 116 | 0 | 16/18 | 2/3 | 5 | 0 | 2 | 0 | 72 | 721/1024 | 1207/1860 |
| looking-for-work | aq-final-fix2 | 116 | 0 | 14/15 | - | 16 | 2 | 4 | 0 | 60 | 1025/1588 | 1487/2019 |
| looking-for-work | aq2-final-fix6 | 116 | 0 | 15/15 | - | 6 | 2 | 5 | 0 | 56 | 772/1246 | 1863/2545 |
| recruiting | aq-final-fix2 | 116 | 0 | 13/15 | - | 8 | 3 | 14 | 3 | 55 | 869/1270 | 1202/1867 |
| recruiting | aq2-final-fix6 | 116 | 0 | 15/15 | - | 7 | 3 | 2 | 2 | 49 | 710/1216 | 1030/1761 |
| sales | aq-final-fix2 | 116 | 0 | 17/17 | 1/2 | 4 | 0 | 1 | 0 | 57 | 891/1396 | 1237/1935 |
| sales | aq2-final-fix6 | 116 | 0 | 17/17 | 2/2 | 2 | 0 | 0 | 0 | 51 | 716/1065 | 1779/2940 |
| seminar | aq-final-fix2 | 116 | 0 | 45/48 | 2/3 | 13 | 0 | 1 | 0 | 65 | 997/1471 | 1475/2700 |
| seminar | aq2-final-fix6 | 116 | 0 | 48/48 | 3/3 | 7 | 0 | 0 | 0 | 63 | 769/1183 | 1268/2452 |
| team-meet | aq-final-fix2 | 116 | 0 | 16/21 | - | 15 | 0 | 2 | 0 | 46 | 882/1338 | 1204/1891 |
| team-meet | aq2-final-fix6 | 116 | 0 | 21/21 | - | 11 | 0 | 2 | 0 | 48 | 746/1085 | 1037/1461 |
| technical-interview | aq-final-fix2 | 116 | 0 | 10/13 | 1/1 | 4 | 0 | 5 | 0 | 85 | 798/1649 | 1344/2354 |
| technical-interview | aq2-final-fix6 | 116 | 0 | 12/13 | 0/1 | 1 | 2 | 4 | 2 | 86 | 718/1241 | 1304/2182 |
| ALL | aq-final-fix2 | 1038 | 0 | 168/188 | 10/16 | 85 | 5 | 31 | 3 | 61 | 889/1371 | 1279/2046 |
| ALL | aq2-final-fix6 | 1038 | 0 | 185/188 | 14/16 | 51 | 7 | 17 | 5 | 59 | 728/1194 | 1374/2401 |

## aq2-sb-cur vs aq2-sb-fix6
| mode | run | n | err | ref needles all-in-prompt | validators pass | epistemic | src-exposure | coaching | meta | words | TTFT p50/p95 | total p50/p95 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| lecture | aq2-sb-cur | 6 | 0 | 4/4 | 3/3 | 0 | 0 | 0 | 0 | 60 | 928/1117 | 1328/2504 |
| lecture | aq2-sb-fix6 | 6 | 0 | 4/4 | 3/3 | 0 | 0 | 0 | 0 | 58 | 622/1053 | 1080/2487 |
| looking-for-work | aq2-sb-cur | 20 | 0 | 3/3 | 1/1 | 3 | 0 | 0 | 0 | 65 | 975/1570 | 1351/2250 |
| looking-for-work | aq2-sb-fix6 | 20 | 0 | 3/3 | 1/1 | 1 | 0 | 0 | 0 | 59 | 975/1202 | 2218/2861 |
| recruiting | aq2-sb-cur | 14 | 0 | 4/6 | - | 1 | 0 | 0 | 0 | 46 | 756/990 | 1032/1313 |
| recruiting | aq2-sb-fix6 | 14 | 0 | 4/6 | - | 1 | 0 | 0 | 0 | 45 | 732/998 | 1041/1346 |
| seminar | aq2-sb-cur | 10 | 0 | 7/7 | 5/5 | 0 | 0 | 0 | 0 | 49 | 1100/1332 | 1652/3451 |
| seminar | aq2-sb-fix6 | 10 | 0 | 7/7 | 4/5 | 0 | 0 | 0 | 0 | 57 | 841/980 | 1707/2699 |
| team-meet | aq2-sb-cur | 14 | 0 | 7/9 | - | 4 | 0 | 0 | 0 | 40 | 1030/1329 | 1141/2105 |
| team-meet | aq2-sb-fix6 | 14 | 0 | 9/9 | - | 1 | 0 | 0 | 0 | 44 | 951/1322 | 1222/2075 |
| technical-interview | aq2-sb-cur | 8 | 0 | - | - | 0 | 0 | 0 | 0 | 91 | 1285/1681 | 1874/2496 |
| technical-interview | aq2-sb-fix6 | 8 | 0 | - | - | 0 | 0 | 0 | 0 | 107 | 1033/1411 | 1844/3175 |
| ALL | aq2-sb-cur | 72 | 0 | 25/29 | 9/9 | 8 | 0 | 0 | 0 | 57 | 934/1595 | 1241/2809 |
| ALL | aq2-sb-fix6 | 72 | 0 | 27/29 | 8/9 | 3 | 0 | 0 | 0 | 58 | 889/1307 | 1562/2709 |

## aq2-sq-cur vs aq2-sq-fix6
| mode | run | n | err | ref needles all-in-prompt | validators pass | epistemic | src-exposure | coaching | meta | words | TTFT p50/p95 | total p50/p95 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| call-center | aq2-sq-cur | 7 | 0 | 6/6 | 5/7 | 0 | 0 | 0 | 0 | 78 | 1079/1571 | 1673/1968 |
| call-center | aq2-sq-fix6 | 7 | 0 | 6/6 | 7/7 | 0 | 0 | 0 | 0 | 76 | 1246/1498 | 2741/2916 |
| general | aq2-sq-cur | 8 | 0 | 2/2 | 6/8 | 0 | 0 | 0 | 0 | 45 | 890/1463 | 1271/1905 |
| general | aq2-sq-fix6 | 8 | 0 | 2/2 | 7/8 | 0 | 0 | 0 | 0 | 48 | 1067/1372 | 1404/1654 |
| lecture | aq2-sq-cur | 3 | 0 | 3/3 | 3/3 | 0 | 0 | 0 | 0 | 56 | 1219/1605 | 1602/3410 |
| lecture | aq2-sq-fix6 | 3 | 0 | 3/3 | 3/3 | 0 | 0 | 0 | 0 | 49 | 1031/1383 | 1315/3430 |
| recruiting | aq2-sq-cur | 3 | 0 | 1/2 | 2/3 | 0 | 0 | 0 | 0 | 66 | 1043/1089 | 1384/1848 |
| recruiting | aq2-sq-fix6 | 3 | 0 | 1/2 | 3/3 | 1 | 0 | 0 | 0 | 72 | 1180/1308 | 1599/1874 |
| sales | aq2-sq-cur | 7 | 0 | 5/5 | 5/7 | 0 | 0 | 0 | 0 | 68 | 1202/3547 | 2875/5668 |
| sales | aq2-sq-fix6 | 7 | 0 | 5/5 | 7/7 | 0 | 0 | 0 | 0 | 65 | 1107/1737 | 2844/4118 |
| team-meet | aq2-sq-cur | 4 | 0 | 4/4 | 4/4 | 0 | 0 | 0 | 0 | 32 | 1260/1531 | 1499/1658 |
| team-meet | aq2-sq-fix6 | 4 | 0 | 4/4 | 4/4 | 0 | 0 | 0 | 0 | 43 | 866/1185 | 1361/2240 |
| ALL | aq2-sq-cur | 32 | 0 | 21/22 | 25/32 | 0 | 0 | 0 | 0 | 59 | 1097/1677 | 1595/4317 |
| ALL | aq2-sq-fix6 | 32 | 0 | 21/22 | 31/32 | 1 | 0 | 0 | 0 | 59 | 1120/1516 | 1859/3759 |

