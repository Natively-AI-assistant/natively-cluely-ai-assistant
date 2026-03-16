# Natively Roadmap

## Vision

Transform meeting transcription into an intelligent knowledge system with specialized AI capabilities and community-driven access.

---

## Planned Features

### 1. System Design Visualization Engine

**Status:** Planned  
**Priority:** High

Create an AI-powered system design generation tool that produces visual diagrams from meeting discussions.

**Capabilities:**

- Generate system architecture diagrams (microservices, monoliths, distributed systems)
- Create flowcharts and state diagrams (DFA/NFA-style visualizations)
- Produce sequence diagrams from conversation flow
- Export in multiple formats (SVG, PNG, Mermaid)

**Technical Approach:**

- Specialized prompting system for structured diagram generation
- Template-based rendering engine
- Integration with visualization libraries (D3.js, Mermaid, or custom renderer)
- RAG-enhanced context for maintaining design consistency across sessions

**Use Cases:**

- Automatically visualize system designs discussed in engineering meetings
- Generate architecture diagrams from technical brainstorming sessions
- Create flowcharts from process discussions
- Document decision trees from strategic meetings

---

### 2. Persona System

**Status:** Planned  
**Priority:** Medium

Allow users to select AI personas that specialize in different professional contexts, changing how Natively analyzes and responds to meeting content.

**Predefined Personas:**

- **Software Engineer**: Technical focus, code-aware, architecture-oriented
- **HR Professional**: People-focused, policy-aware, culture-sensitive
- **Product Manager**: Feature-driven, user-centric, roadmap-oriented
- **Sales Representative**: Deal-focused, relationship-aware, revenue-oriented
- **Executive/Leadership**: Strategic, high-level, decision-focused
- **Designer**: UX/UI aware, user journey focused, accessibility-minded
- **Data Analyst**: Metrics-driven, insight-focused, trend-aware

**Features:**

- Persona-specific question suggestions
- Tailored summary formats
- Domain-specific terminology and insights
- Custom RAG retrieval strategies per persona

**Implementation:**

- Persona-based system prompts
- Specialized embedding strategies
- Context-aware response formatting
- Persona memory for consistent interactions

---

### 3. Natively Token & Pro Access

**Status:** Planned  
**Priority:** Medium-High

Implement a token-based rewards system that provides free premium access to community supporters.

**Token Benefits:**

- **1 Month Free Pro**: Upon acquiring Natively token
- **Continuous Pro Access**: As long as token is held
- **Early Feature Access**: Beta features for token holders
- **Governance Rights**: Vote on feature priorities (future consideration)

**Implementation Considerations:**

- Token verification system (blockchain integration)
- Wallet connection flow
- Token balance monitoring
- Subscription state management
- Fallback for non-token holders (standard Pro subscriptions)

**Pro Features (with Token Access):**

- Unlimited meeting uploads
- Advanced RAG search
- System design visualization
- All persona access
- Priority processing
- Extended history retention
- Export capabilities
- API access

---

## Future Considerations

### Short-term (Next 1-3 months)

- [ ] System design visualization MVP
- [ ] Basic persona system (3-5 personas)
- [ ] Token integration research and proof-of-concept

### Medium-term (3-6 months)

- [ ] Full persona library
- [ ] Advanced diagram types and customization
- [ ] Token holder community features
- [ ] Mobile app development

### Long-term (6+ months)

- [ ] Collaborative features
- [ ] Plugin ecosystem
- [ ] Multi-language support

---

## Contributing

We welcome community input on our roadmap. If you have feature suggestions or want to contribute to development, please:

1. Open an issue with the `feature-request` label
2. Join our community discussions
3. Submit PRs for approved features

---

## Notes

This roadmap is subject to change based on user feedback, technical feasibility, and business priorities. Features are not guaranteed and timelines are estimates.

**Last Updated:** March 2026
