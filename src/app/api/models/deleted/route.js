import { NextResponse } from "next/server";
import { getDeletedModels, deleteModels, restoreDeletedModels } from "@/lib/deletedModelsDb";

export const dynamic = "force-dynamic";

// GET /api/models/deleted?providerAlias=xxx
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const providerAlias = searchParams.get("providerAlias");
    const all = await getDeletedModels();
    if (providerAlias) return NextResponse.json({ ids: all[providerAlias] || [] });
    return NextResponse.json({ deleted: all });
  } catch (error) {
    console.log("Error fetching deleted models:", error);
    return NextResponse.json({ error: "Failed to fetch deleted models" }, { status: 500 });
  }
}

// POST /api/models/deleted  body: { providerAlias, ids: [...] }
export async function POST(request) {
  try {
    const { providerAlias, ids } = await request.json();
    if (!providerAlias || !Array.isArray(ids)) {
      return NextResponse.json({ error: "providerAlias and ids[] required" }, { status: 400 });
    }
    await deleteModels(providerAlias, ids);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error marking models as deleted:", error);
    return NextResponse.json({ error: "Failed to delete models" }, { status: 500 });
  }
}

// DELETE /api/models/deleted?providerAlias=xxx[&id=yyy]
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const providerAlias = searchParams.get("providerAlias");
    const id = searchParams.get("id");
    if (!providerAlias) {
      return NextResponse.json({ error: "providerAlias required" }, { status: 400 });
    }
    await restoreDeletedModels(providerAlias, id ? [id] : []);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error restoring deleted models:", error);
    return NextResponse.json({ error: "Failed to restore models" }, { status: 500 });
  }
}
