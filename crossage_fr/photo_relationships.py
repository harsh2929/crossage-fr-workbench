"""Conservative relationship-graph suggestions for unnamed face clusters."""

from __future__ import annotations

import hashlib
import json
import math
from typing import Any, Iterable, Mapping


PHOTO_RELATIONSHIP_GRAPH_VERSION = "relationship-name-v1"
UNMATCHED_CLUSTER_PREFIX = "unmatched cluster"


def _clean_name(value: Any) -> str:
    return " ".join(str(value or "").strip().split())[:200]


def _name_key(value: Any) -> str:
    return _clean_name(value).casefold()


def _is_unknown(value: Any) -> bool:
    return _name_key(value).startswith(UNMATCHED_CLUSTER_PREFIX)


def _sha256_json(value: Any) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def rank_relationship_name_suggestions(
    nodes: Iterable[Mapping[str, Any]],
    edges: Iterable[Mapping[str, Any]],
    *,
    excluded_people: Iterable[str] = (),
    dismissed_suggestion_ids: Iterable[str] = (),
    source_cluster: str = "",
    min_score: float = 0.38,
    min_source_assets: int = 2,
    min_relationship_support: int = 2,
    per_cluster_limit: int = 3,
    limit: int = 50,
) -> dict[str, Any]:
    """Rank existing names for unnamed clusters from repeated social context.

    A candidate is never emitted when it occurs in the same asset as the
    unnamed cluster. That veto is stronger than any neighborhood similarity:
    two faces visible together cannot be the same identity.
    """

    threshold = max(0.0, min(1.0, float(min_score)))
    source_min = max(2, int(min_source_assets))
    support_min = max(2, int(min_relationship_support))
    cluster_cap = max(1, min(10, int(per_cluster_limit)))
    result_cap = max(1, min(200, int(limit)))
    excluded = {_name_key(value) for value in excluded_people if _name_key(value)}
    dismissed = {str(value or "").strip() for value in dismissed_suggestion_ids if str(value or "").strip()}
    requested_source = _name_key(source_cluster)

    node_map: dict[str, dict[str, Any]] = {}
    for raw in nodes:
        name = _clean_name(raw.get("personName", raw.get("name", "")))
        key = _name_key(name)
        if not key or key in excluded:
            continue
        try:
            asset_count = max(0, int(raw.get("assetCount", raw.get("count", 0)) or 0))
        except (TypeError, ValueError):
            asset_count = 0
        current = node_map.get(key)
        if current is None or asset_count > int(current["assetCount"]):
            node_map[key] = {
                "personName": name,
                "assetCount": asset_count,
                "unknown": _is_unknown(name),
            }

    adjacency: dict[str, dict[str, int]] = {key: {} for key in node_map}
    canonical_edges: dict[tuple[str, str], int] = {}
    for raw in edges:
        left_key = _name_key(raw.get("personA", raw.get("left", "")))
        right_key = _name_key(raw.get("personB", raw.get("right", "")))
        if not left_key or not right_key or left_key == right_key:
            continue
        if left_key not in node_map or right_key not in node_map:
            continue
        try:
            count = max(0, int(raw.get("cooccurrenceCount", raw.get("count", 0)) or 0))
        except (TypeError, ValueError):
            count = 0
        if count <= 0:
            continue
        pair = tuple(sorted((left_key, right_key)))
        canonical_edges[pair] = canonical_edges.get(pair, 0) + count

    for (left_key, right_key), count in canonical_edges.items():
        adjacency[left_key][right_key] = count
        adjacency[right_key][left_key] = count

    graph_payload = {
        "version": PHOTO_RELATIONSHIP_GRAPH_VERSION,
        "nodes": [
            [key, node_map[key]["personName"], node_map[key]["assetCount"], node_map[key]["unknown"]]
            for key in sorted(node_map)
        ],
        "edges": [[left, right, canonical_edges[(left, right)]] for left, right in sorted(canonical_edges)],
    }
    graph_hash = _sha256_json(graph_payload)
    named_keys = sorted(key for key, row in node_map.items() if not row["unknown"])
    unknown_keys = sorted(key for key, row in node_map.items() if row["unknown"])
    if requested_source:
        unknown_keys = [key for key in unknown_keys if key == requested_source]

    suggestions: list[dict[str, Any]] = []
    blocked_direct = 0
    evaluated = 0
    for unknown_key in unknown_keys:
        unknown_node = node_map[unknown_key]
        if int(unknown_node["assetCount"]) < source_min:
            continue
        unknown_neighbors = {
            key: count
            for key, count in adjacency.get(unknown_key, {}).items()
            if key in node_map and not node_map[key]["unknown"]
        }
        if not unknown_neighbors:
            continue
        cluster_suggestions: list[dict[str, Any]] = []
        for target_key in named_keys:
            target_node = node_map[target_key]
            if int(target_node["assetCount"]) < 2:
                continue
            evaluated += 1
            direct_count = int(adjacency.get(unknown_key, {}).get(target_key, 0) or 0)
            if direct_count > 0:
                blocked_direct += 1
                continue
            target_neighbors = {
                key: count
                for key, count in adjacency.get(target_key, {}).items()
                if key in node_map and not node_map[key]["unknown"] and key != unknown_key
            }
            shared_keys = sorted(set(unknown_neighbors) & set(target_neighbors))
            if not shared_keys:
                continue

            relationship_rows: list[dict[str, Any]] = []
            weighted_overlap = 0.0
            weighted_union = 0.0
            unknown_weight = 0.0
            support = 0
            all_neighbor_keys = set(unknown_neighbors) | set(target_neighbors)
            for neighbor_key in all_neighbor_keys:
                # Frequent library-wide identities carry less identifying
                # information than a smaller, repeated shared relationship.
                inverse_frequency = 1.0 / max(1.0, math.log2(2.0 + float(node_map[neighbor_key]["assetCount"])))
                unknown_value = float(unknown_neighbors.get(neighbor_key, 0)) * inverse_frequency
                target_value = float(target_neighbors.get(neighbor_key, 0)) * inverse_frequency
                weighted_overlap += min(unknown_value, target_value)
                weighted_union += max(unknown_value, target_value)
                unknown_weight += unknown_value
                if neighbor_key in shared_keys:
                    raw_support = min(unknown_neighbors[neighbor_key], target_neighbors[neighbor_key])
                    support += raw_support
                    relationship_rows.append({
                        "personName": str(node_map[neighbor_key]["personName"]),
                        "sourceCooccurrences": int(unknown_neighbors[neighbor_key]),
                        "targetCooccurrences": int(target_neighbors[neighbor_key]),
                        "support": int(raw_support),
                    })

            if support < support_min or weighted_union <= 0.0 or unknown_weight <= 0.0:
                continue
            relationship_rows.sort(key=lambda row: (-int(row["support"]), str(row["personName"]).casefold()))
            weighted_jaccard = weighted_overlap / weighted_union
            source_coverage = weighted_overlap / unknown_weight
            support_strength = min(1.0, support / 6.0)
            score = max(0.0, min(1.0, 0.55 * weighted_jaccard + 0.30 * source_coverage + 0.15 * support_strength))
            if score < threshold:
                continue
            confidence = (
                "strong"
                if len(relationship_rows) >= 2 and support >= 5 and score >= 0.60
                else "moderate"
            )
            score_components = {
                "weightedNeighborhoodOverlap": round(weighted_jaccard, 6),
                "sourceNeighborhoodCoverage": round(source_coverage, 6),
                "supportStrength": round(support_strength, 6),
            }
            evidence = {
                "graphVersion": PHOTO_RELATIONSHIP_GRAPH_VERSION,
                "sourceClusterKey": unknown_key,
                "targetPersonKey": target_key,
                "sourceAssetCount": int(unknown_node["assetCount"]),
                "targetAssetCount": int(target_node["assetCount"]),
                "sharedRelationships": relationship_rows,
                "relationshipSupport": support,
                "directCooccurrenceCount": 0,
                "score": round(score, 6),
                "scoreComponents": score_components,
            }
            evidence_hash = _sha256_json(evidence)
            suggestion_id = f"relationship_name_{evidence_hash[:24]}"
            if suggestion_id in dismissed:
                continue
            shared_names = [str(row["personName"]) for row in relationship_rows[:3]]
            cluster_suggestions.append({
                "suggestionId": suggestion_id,
                "evidenceHash": evidence_hash,
                "graphVersion": PHOTO_RELATIONSHIP_GRAPH_VERSION,
                "sourceCluster": str(unknown_node["personName"]),
                "targetPerson": str(target_node["personName"]),
                "score": round(score, 6),
                "confidence": confidence,
                "sourceAssetCount": int(unknown_node["assetCount"]),
                "targetAssetCount": int(target_node["assetCount"]),
                "sharedRelationshipCount": len(relationship_rows),
                "relationshipSupport": support,
                "directCooccurrenceCount": 0,
                "sharedRelationships": relationship_rows,
                "scoreComponents": score_components,
                "reason": (
                    f"Relationship patterns overlap around {', '.join(shared_names)}; "
                    "no visible asset contains both identities."
                ),
                "reviewRequired": True,
                "autoApply": False,
                "undoAvailable": True,
            })
        cluster_suggestions.sort(
            key=lambda row: (
                -float(row["score"]),
                -int(row["relationshipSupport"]),
                str(row["targetPerson"]).casefold(),
            )
        )
        suggestions.extend(cluster_suggestions[:cluster_cap])

    suggestions.sort(
        key=lambda row: (
            -float(row["score"]),
            -int(row["relationshipSupport"]),
            str(row["sourceCluster"]).casefold(),
            str(row["targetPerson"]).casefold(),
        )
    )
    return {
        "graphVersion": PHOTO_RELATIONSHIP_GRAPH_VERSION,
        "graphHash": graph_hash,
        "graphStats": {
            "nodes": len(node_map),
            "namedPeople": len(named_keys),
            "unknownClusters": sum(1 for row in node_map.values() if row["unknown"]),
            "edges": len(canonical_edges),
            "candidatesEvaluated": evaluated,
            "blockedByDirectCooccurrence": blocked_direct,
        },
        "minimums": {
            "score": round(threshold, 6),
            "sourceAssets": source_min,
            "relationshipSupport": support_min,
        },
        "suggestions": suggestions[:result_cap],
    }

