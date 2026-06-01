# Real API Latency Report

Endpoint: `https://api.natively.software/v1/chat`

## manual_identity
count: 10
p50/p95 first byte: 0.118/0.473ms
p50/p95 first token: 0.118/0.473ms
p50/p95 first useful token: 0.12/0.474ms
p50/p95 total: 0.12/0.474ms
slowest 5: BE-001=0.474ms, DA-001=0.145ms, ML-001=0.142ms, CSM-001=0.131ms, PM-001=0.12ms
likely bottleneck: deterministic (no provider)

## manual_projects
count: 9
p50/p95 first byte: 5542.718/8086.796ms
p50/p95 first token: 5542.76/8086.808ms
p50/p95 first useful token: 5542.766/8086.811ms
p50/p95 total: 6041.618/8905.383ms
slowest 5: ML-003=8086.811ms, BE-003=7987.219ms, SRE-003=6868.637ms, PM-003=6850.491ms, DA-010=5542.766ms
likely bottleneck: provider prefill + network

## manual_skills
count: 2
p50/p95 first byte: 5200.299/5200.299ms
p50/p95 first token: 5200.356/5200.356ms
p50/p95 first useful token: 5200.375/5200.375ms
p50/p95 total: 5735.451/5735.451ms
slowest 5: BE-006=5200.375ms, ML-006=1557.806ms
likely bottleneck: provider prefill + network

## manual_jd_fit
count: 8
p50/p95 first byte: 6400.621/8604.962ms
p50/p95 first token: 6400.664/8604.976ms
p50/p95 first useful token: 6400.669/8604.977ms
p50/p95 total: 6981.032/9204.588ms
slowest 5: SRE-005=8604.977ms, UX-005=8267.223ms, CY-005=7049.125ms, SDR-005=6400.669ms, FND-005=6211.053ms
likely bottleneck: provider prefill + network

## manual_negotiation
count: 5
p50/p95 first byte: 7100.402/8502.615ms
p50/p95 first token: 7100.436/8502.629ms
p50/p95 first useful token: 7100.439/8502.631ms
p50/p95 total: 7782.256/9430.84ms
slowest 5: SRE-008=8502.631ms, UX-008=7668.05ms, CY-008=7100.439ms, PM-008=6684.785ms, ML-008=5710.438ms
likely bottleneck: provider prefill + network

## what_to_answer_identity
count: 10
p50/p95 first byte: 0.488/1.542ms
p50/p95 first token: 0.489/1.546ms
p50/p95 first useful token: 0.49/1.548ms
p50/p95 total: 0.49/1.548ms
slowest 5: BE-002=1.548ms, ML-002=0.812ms, PM-002=0.633ms, CSM-002=0.539ms, CY-002=0.49ms
likely bottleneck: deterministic (no provider)

## what_to_answer_projects
count: 2
p50/p95 first byte: 9030.957/9030.957ms
p50/p95 first token: 9031.004/9031.004ms
p50/p95 first useful token: 9031.015/9031.015ms
p50/p95 total: 9314.07/9314.07ms
slowest 5: ML-004=9031.015ms, BE-004=6928.925ms
likely bottleneck: provider prefill + network

## what_to_answer_followup
count: 10
p50/p95 first byte: 7298.15/11453.107ms
p50/p95 first token: 7298.204/11453.15ms
p50/p95 first useful token: 7298.211/11453.155ms
p50/p95 total: 7542.567/12075.226ms
slowest 5: FND-007=11453.155ms, SDR-007=8326.422ms, PM-007=7583.343ms, CY-007=7473.933ms, UX-007=7298.211ms
likely bottleneck: provider prefill + network

## what_to_answer_jd_fit
count: 2
p50/p95 first byte: 8806.642/8806.642ms
p50/p95 first token: 8806.701/8806.701ms
p50/p95 first useful token: 8806.715/8806.715ms
p50/p95 total: 9504.224/9504.224ms
slowest 5: ML-005=8806.715ms, BE-005=6811.083ms
likely bottleneck: provider prefill + network

## what_to_answer_negotiation
count: 5
p50/p95 first byte: 5982.127/7931.537ms
p50/p95 first token: 5982.171/7931.594ms
p50/p95 first useful token: 5982.181/7931.6ms
p50/p95 total: 6576.095/8448.188ms
slowest 5: SDR-008=7931.6ms, CSM-008=6116.627ms, BE-008=5982.181ms, FND-008=5949.612ms, DA-008=1452.177ms
likely bottleneck: provider prefill + network

