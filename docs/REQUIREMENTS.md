# Publishing verified requirements

No verified rules are shipped. Official San José source requests were blocked by network policy during implementation. Directory URLs identify intended departments and portals; they are not proof of a requirement or independently verified parcel authority.

Before publishing the first San José residential HVAC workflow:

1. Retrieve the current official city application instructions and linked forms. Archive the source document, retrieval time, and source URL. Confirm the current permit pathway, equipment scope, exclusions, and effective dates with the authority where ambiguous.
2. Review each proposed record independently. Record requirement code, jurisdiction, category, title, exact supporting document/information, description, version, effective date when known, actual verification date, and exceptions/limitations.
3. Insert `requirements` and `requirement_versions` through an administrator-controlled migration. Start unverified, then mark verified only after evidence review. Do not insert application guesses or historical Shovels records as rules.
4. `conditions` currently supports `{ "propertyTypes": ["Single-family"] }` or `{}`. Unknown condition keys fail closed. Expand the typed evaluator and tests before publishing other condition shapes. `required_support` matches a document category exactly. Document presence produces “Needs clarification,” never automatic technical approval.
5. Test both applicable and excluded categories and jurisdictions. Versions are append-only operationally; supersede with a new version. Application users cannot modify rules.

San José and unincorporated Santa Clara County are distinct authorities. A mailing address cannot establish parcel jurisdiction. The MVP records explicit user confirmation as **manual**, not authoritative boundary verification. Add official parcel/boundary integration later.

## Historical Shovels research

No CSV was found in the repository. Later, import a supplied CSV into a separate research-only staging table or offline notebook, retaining original source row IDs, jurisdiction labels, permit IDs, and retrieval dates. Validate column mappings, remove unnecessary personal data, and deduplicate using the source identifier. Keep records separate from the requirement tables and never infer permitting authority or requirements solely from mailing city or ZIP. Historical records are supplemental research, not official rules. No records have been fabricated or imported.
