# MermaidJS Diagrams

live here because NPM does not support mermraid rendering in README, so diagrams live here and manually rendered and to media directory, so they can be linked to README as images


### Open vs CLosed thinking

Diagram shows comaprison fo Open and Closed thinking/reasoning block flow and what ends up in harness and context.


```mermaid
flowchart LR
   User["User prompt"] --> Pi["Pi context builder"]
   
   Pi --> API["Public API"]
   subgraph Hosted["Private model provider Claude / OpenAI"]
      API --> Hidden["Hidden internal thinking"]
      Hidden --> Summary["Opaque summary"]
      Summary --> Limited["Response with compacted opaque thinking block"]
   end
   Limited --> Store["Pi stores exposed output only "]
   
   Pi --> OpenAPI["Open API"]
   subgraph Open["Open model Local / Remote"]
     OpenAPI --> Public["Model thinking block"]
     Public --> FullResponse["Response with full thinking block"]
   end
   FullResponse --> SimplePiSession["Pi stores response with full thinking block"]
   FullResponse --> PickThinking["Full thinking block"]
   Zip --> LocalAPI
   subgraph Local["Open local model (llama.cpp)"]
   LocalAPI["Local API"] --> LocalSummary["Cavemaned compacted thinking block"]
   end
   LocalSummary --> ZipResponse
   subgraph extension["pi-reasoning-zip"]
   PickThinking --> Zip["Apply caveman and compact"]
   ZipResponse["Response with compact thinking block"]
   end
   ZipResponse --> CompactPiSession["Pi stores response with compacted thinking block"]
   
   classDef local fill:#e3f2ea,stroke:#2f7d5b,color:#20231f;
   classDef hosted fill:#e9ecfb,stroke:#4c5fb5,color:#20231f;
   classDef warn fill:#faeadf,stroke:#b35b2d,color:#20231f;
   class OpenAPI,Public,FullResponse,LocalAPI,LocalSummary local;
   class API,Hidden,Limited,Summary hosted;
   class Public,Hidden warn;
```
