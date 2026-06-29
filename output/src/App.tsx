import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState, type InputHTMLAttributes, type SelectHTMLAttributes } from "react";
import { z } from "zod";
import { loadState, saveState } from "./lib/storage";
import { checkIn, checkOut } from "./services/attendanceService";
import { sendEmail } from "./services/emailService";
import { makeId, nowIso } from "./services/helpers";
import { sendFollowupMessage } from "./services/messageService";
import { shareProperty } from "./services/propertyShareService";
import { createSocialPost, draftCaption } from "./services/socialPostService";
import { ingestLeadWebhook } from "./services/webhookService";
import { followupSchema, leadFormSchema, propertyFormSchema } from "./schemas";
import type {
  CRMState,
  Followup,
  Lead,
  LeadStatus,
  Profile,
  Property,
  SocialPostStatus,
  SocialPostType,
} from "./types";

type MainTab = "Dashboard" | "Leads" | "Properties" | "Follow-ups" | "More";
type MoreTab = "Attendance" | "Social Media" | "Team" | "Settings" | "Integrations" | "Reports";

const mainTabs: MainTab[] = ["Dashboard", "Leads", "Properties", "Follow-ups", "More"];
const moreTabs: MoreTab[] = ["Attendance", "Social Media", "Team", "Settings", "Integrations", "Reports"];
const leadStatuses: LeadStatus[] = [
  "New",
  "Contacted",
  "Interested",
  "Site Visit Scheduled",
  "Negotiation",
  "Won",
  "Lost",
  "Not Responding",
  "Call Pending",
];

const followupTemplates = [
  "Hi {{leadName}}, just checking if you had a chance to review the property details I shared.",
  "Hi {{leadName}}, are you available for a quick call today to discuss properties in {{preferredLocation}}?",
  "Hi {{leadName}}, we have a few new options matching your budget. Should I share them?",
];

function formatTime(input: string | null) {
  return input ? new Date(input).toLocaleString() : "-";
}

function Badge({ text }: { text: string }) {
  return <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">{text}</span>;
}

function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-indigo-400"
    />
  );
}

function SelectInput(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-indigo-400"
    />
  );
}

export default function App() {
  const [state, setState] = useState<CRMState>(() => loadState());
  const [activeTab, setActiveTab] = useState<MainTab>("Dashboard");
  const [activeMoreTab, setActiveMoreTab] = useState<MoreTab>("Attendance");
  const [activeUserId, setActiveUserId] = useState(state.profiles[0]?.id ?? "");
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [leadSearch, setLeadSearch] = useState("");
  const [leadFilterStatus, setLeadFilterStatus] = useState("All");
  const [propertyFilter, setPropertyFilter] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  const currentUser = state.profiles.find((profile) => profile.id === activeUserId) ?? state.profiles[0];
  const selectedLead = state.leads.find((lead) => lead.id === selectedLeadId) ?? null;

  useEffect(() => {
    saveState(state);
  }, [state]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(timer);
  }, [toast]);

  const dashboardMetrics = useMemo(() => {
    const today = new Date().toDateString();
    const leadsToday = state.leads.filter((lead) => new Date(lead.createdAt).toDateString() === today).length;
    const callsToday = state.calls.filter((call) => new Date(call.startedAt).toDateString() === today).length;
    const followupsDue = state.followups.filter(
      (f) => f.status !== "Completed" && new Date(f.dueAt).toDateString() === today
    ).length;
    const hotLeads = state.leads.filter((lead) => lead.temperature === "Hot").length;
    const visits = state.leads.filter((lead) => lead.status === "Site Visit Scheduled").length;
    const inventory = state.properties.filter((property) => property.availabilityStatus === "Available").length;
    const checkedIn = state.attendance.filter((entry) => !entry.checkOutTime).length;
    return { leadsToday, callsToday, followupsDue, hotLeads, visits, inventory, checkedIn };
  }, [state]);

  const filteredLeads = useMemo(() => {
    return state.leads.filter((lead) => {
      const matchesSearch = `${lead.fullName} ${lead.phone} ${lead.preferredLocation}`
        .toLowerCase()
        .includes(leadSearch.toLowerCase());
      const matchesStatus = leadFilterStatus === "All" || lead.status === leadFilterStatus;
      if (currentUser.role === "sales_agent") {
        return matchesSearch && matchesStatus && lead.assignedAgentId === currentUser.id;
      }
      return matchesSearch && matchesStatus;
    });
  }, [state.leads, leadSearch, leadFilterStatus, currentUser]);

  const filteredProperties = useMemo(() => {
    return state.properties.filter((property) =>
      `${property.title} ${property.location} ${property.propertyType}`
        .toLowerCase()
        .includes(propertyFilter.toLowerCase())
    );
  }, [state.properties, propertyFilter]);

  function updateLead(leadId: string, updater: (lead: Lead) => Lead) {
    setState((prev) => ({
      ...prev,
      leads: prev.leads.map((lead) => (lead.id === leadId ? updater(lead) : lead)),
    }));
  }

  function addActivity(leadId: string, type: "call" | "message" | "note" | "followup" | "property_share" | "status_change", content: string) {
    setState((prev) => ({
      ...prev,
      activities: [
        {
          id: makeId("act"),
          organizationId: prev.organization.id,
          leadId,
          actorId: currentUser.id,
          type,
          content,
          createdAt: nowIso(),
        },
        ...prev.activities,
      ],
    }));
  }

  function createLeadFromForm(formData: FormData) {
    const parsed = leadFormSchema.safeParse({
      fullName: formData.get("fullName"),
      phone: formData.get("phone"),
      email: formData.get("email"),
      source: formData.get("source"),
      propertyType: formData.get("propertyType"),
      budgetMin: Number(formData.get("budgetMin")),
      budgetMax: Number(formData.get("budgetMax")),
      preferredLocation: formData.get("preferredLocation"),
      notes: formData.get("notes"),
      nextFollowupAt: formData.get("nextFollowupAt"),
    });

    if (!parsed.success) {
      setToast(parsed.error.issues[0]?.message ?? "Lead form is invalid");
      return;
    }

    try {
      const result = ingestLeadWebhook(state, parsed.data);
      const nextFollowupAt = parsed.data.nextFollowupAt ? new Date(parsed.data.nextFollowupAt).toISOString() : null;
      const lead = { ...result.lead, nextFollowupAt, source: "Manual" as const };
      setState({
        ...result.state,
        leads: [lead, ...result.state.leads.filter((entry) => entry.id !== lead.id)],
      });
      setToast("Lead created, assigned, and instant call workflow triggered.");
    } catch (error) {
      if (error instanceof z.ZodError) {
        setToast(error.issues[0]?.message ?? "Validation failed");
        return;
      }
      setToast("Unable to create lead");
    }
  }

  function createWebhookLead() {
    const payload = {
      fullName: "Rahul Sharma",
      phone: "+919999999999",
      email: "rahul@example.com",
      source: "36 Acre" as const,
      propertyType: "Apartment" as const,
      budgetMin: 7500000,
      budgetMax: 12000000,
      preferredLocation: "Gurgaon",
      notes: "Looking for 3BHK near Golf Course Road",
    };
    const result = ingestLeadWebhook(state, payload);
    setState(result.state);
    setToast("Webhook lead ingested and call bridge workflow completed.");
  }

  function handleQuickCall(lead: Lead) {
    setState((prev) => ({
      ...prev,
      calls: [
        {
          id: makeId("call"),
          organizationId: prev.organization.id,
          leadId: lead.id,
          agentId: currentUser.id,
          callSid: makeId("CA"),
          conferenceSid: makeId("CF"),
          status: "completed",
          duration: 95,
          recordingUrl: null,
          startedAt: nowIso(),
          endedAt: new Date(Date.now() + 1000 * 95).toISOString(),
          outcome: "Connected",
        },
        ...prev.calls,
      ],
    }));
    updateLead(lead.id, (draft) => ({ ...draft, status: "Contacted", lastContactedAt: nowIso() }));
    addActivity(lead.id, "call", `One-click call completed by ${currentUser.fullName}`);
    setToast("Call logged successfully");
  }

  function shareFirstMatchedProperty(lead: Lead) {
    const match = state.properties.find(
      (property) =>
        property.location.toLowerCase().includes(lead.preferredLocation.toLowerCase().slice(0, 4)) &&
        property.propertyType === lead.propertyType
    );
    if (!match) {
      setToast("No recommended property found for this lead");
      return;
    }

    const { message, activity } = shareProperty(state, lead, match, currentUser);
    setState((prev) => ({ ...prev, messages: [message, ...prev.messages], activities: [activity, ...prev.activities] }));
    setToast("Property details sent via WhatsApp template");
  }

  function sendQuickFollowup(lead: Lead, channel: "WhatsApp" | "SMS" | "Email") {
    if (channel === "Email") {
      const email = sendEmail(state, lead, currentUser, "Sharing shortlisted options. Reply to schedule a call.");
      setState((prev) => ({ ...prev, messages: [email, ...prev.messages] }));
      addActivity(lead.id, "message", "Follow-up email sent");
      setToast("Email follow-up sent");
      return;
    }

    const message = sendFollowupMessage(state, lead, currentUser, channel, followupTemplates[0]);
    setState((prev) => ({ ...prev, messages: [message, ...prev.messages] }));
    addActivity(lead.id, "message", `${channel} follow-up sent`);
    setToast(`${channel} follow-up sent`);
  }

  function createProperty(formData: FormData) {
    const parsed = propertyFormSchema.safeParse({
      title: formData.get("title"),
      location: formData.get("location"),
      address: formData.get("address"),
      propertyType: formData.get("propertyType"),
      price: Number(formData.get("price")),
      size: formData.get("size"),
      bedrooms: Number(formData.get("bedrooms")),
      bathrooms: Number(formData.get("bathrooms")),
      floor: formData.get("floor"),
      furnishingStatus: formData.get("furnishingStatus"),
      availabilityStatus: formData.get("availabilityStatus"),
      description: formData.get("description"),
    });
    if (!parsed.success) {
      setToast(parsed.error.issues[0]?.message ?? "Property form invalid");
      return;
    }
    const property: Property = {
      id: makeId("prop"),
      organizationId: state.organization.id,
      ...parsed.data,
      amenities: ["Lift", "Security", "Power Backup"],
      images: ["https://picsum.photos/seed/new-property/900/600"],
      documents: ["Brochure.pdf"],
      developer: "Internal",
      tags: ["new"],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    setState((prev) => ({ ...prev, properties: [property, ...prev.properties] }));
    setToast("Property inventory updated");
  }

  function addFollowup(formData: FormData) {
    const parsed = followupSchema.safeParse({
      leadId: formData.get("leadId"),
      assignedTo: currentUser.id,
      channel: formData.get("channel"),
      template: formData.get("template"),
      dueAt: formData.get("dueAt"),
    });

    if (!parsed.success) {
      setToast(parsed.error.issues[0]?.message ?? "Follow-up invalid");
      return;
    }

    const followup: Followup = {
      id: makeId("fol"),
      organizationId: state.organization.id,
      ...parsed.data,
      status: "Pending",
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    setState((prev) => ({ ...prev, followups: [followup, ...prev.followups] }));
    addActivity(followup.leadId, "followup", `Follow-up scheduled on ${formatTime(followup.dueAt)}`);
    setToast("Follow-up scheduled");
  }

  function runAttendance(action: "in" | "out") {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coords = position.coords;
        if (action === "in") {
          const entry = checkIn(state, currentUser, coords, "Checked in via mobile");
          setState((prev) => ({ ...prev, attendance: [entry, ...prev.attendance] }));
          setToast("Checked in with GPS");
          return;
        }

        const openEntry = state.attendance.find((entry) => entry.userId === currentUser.id && !entry.checkOutTime);
        if (!openEntry) {
          setToast("No open attendance entry found");
          return;
        }

        const updated = checkOut(openEntry, coords);
        setState((prev) => ({
          ...prev,
          attendance: prev.attendance.map((item) => (item.id === openEntry.id ? updated : item)),
        }));
        setToast("Checked out with GPS");
      },
      () => setToast("GPS permission needed for attendance")
    );
  }

  function createPost(formData: FormData) {
    const caption = (formData.get("caption") as string) || "";
    const post = createSocialPost(state, {
      type: formData.get("type") as SocialPostType,
      caption: caption || draftCaption("Upcoming launches in Gurgaon"),
      mediaUrl: (formData.get("mediaUrl") as string) || "https://picsum.photos/seed/post-new/600/600",
      status: formData.get("status") as SocialPostStatus,
      scheduledAt: new Date((formData.get("scheduledAt") as string) || Date.now()).toISOString(),
      assignedTo: formData.get("assignedTo") as string,
      notes: (formData.get("notes") as string) || "",
    });
    setState((prev) => ({ ...prev, socialPosts: [post, ...prev.socialPosts] }));
    setToast("Social post saved");
  }

  function inviteMember(formData: FormData) {
    const fullName = String(formData.get("fullName") || "").trim();
    const email = String(formData.get("email") || "").trim();
    const role = String(formData.get("role") || "sales_agent") as Profile["role"];
    if (!fullName || !email) {
      setToast("Name and email are required");
      return;
    }
    const profile: Profile = {
      id: makeId("usr"),
      organizationId: state.organization.id,
      fullName,
      email,
      phone: "+910000000000",
      role,
      isAvailable: true,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    setState((prev) => ({ ...prev, profiles: [...prev.profiles, profile] }));
    setToast("Team member invited");
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col bg-slate-50">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-indigo-600">EstateFlow CRM</p>
            <h1 className="text-lg font-semibold text-slate-900">Mobile-first Real Estate Operations</h1>
          </div>
          <SelectInput value={activeUserId} onChange={(event) => setActiveUserId(event.target.value)}>
            {state.profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.fullName} ({profile.role})
              </option>
            ))}
          </SelectInput>
        </div>
      </header>

      <main className="flex-1 space-y-4 px-4 py-4 pb-28">
        {activeTab === "Dashboard" && (
          <section className="space-y-4">
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="grid grid-cols-2 gap-3 sm:grid-cols-4"
            >
              {[
                ["New leads", dashboardMetrics.leadsToday],
                ["Calls today", dashboardMetrics.callsToday],
                ["Due follow-ups", dashboardMetrics.followupsDue],
                ["Hot leads", dashboardMetrics.hotLeads],
                ["Site visits", dashboardMetrics.visits],
                ["Inventory", dashboardMetrics.inventory],
                ["Checked in", dashboardMetrics.checkedIn],
              ].map(([label, value]) => (
                <motion.div
                  key={label}
                  whileHover={{ y: -2 }}
                  className="rounded-2xl border border-slate-200 bg-white p-3"
                >
                  <p className="text-xs text-slate-500">{label}</p>
                  <p className="text-xl font-semibold text-slate-900">{value}</p>
                </motion.div>
              ))}
            </motion.div>

            <div className="grid gap-3 md:grid-cols-2">
              <form
                className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  createLeadFromForm(new FormData(event.currentTarget));
                  event.currentTarget.reset();
                }}
              >
                <p className="text-sm font-semibold">Quick Add Lead</p>
                <TextInput name="fullName" placeholder="Full name" required />
                <TextInput name="phone" placeholder="Phone (+91...)" required />
                <TextInput name="email" placeholder="Email" />
                <div className="grid grid-cols-2 gap-2">
                  <SelectInput name="source">
                    <option>Manual</option>
                    <option>36 Acre</option>
                    <option>MagicBricks</option>
                    <option>Website</option>
                  </SelectInput>
                  <SelectInput name="propertyType">
                    <option>Apartment</option>
                    <option>Villa</option>
                    <option>Plot</option>
                    <option>Commercial</option>
                    <option>Rental</option>
                  </SelectInput>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <TextInput name="budgetMin" placeholder="Budget min" type="number" required />
                  <TextInput name="budgetMax" placeholder="Budget max" type="number" required />
                </div>
                <TextInput name="preferredLocation" placeholder="Preferred location" required />
                <TextInput name="notes" placeholder="Notes" />
                <TextInput name="nextFollowupAt" type="datetime-local" />
                <button className="h-11 w-full rounded-xl bg-indigo-600 text-sm font-semibold text-white">Save lead</button>
              </form>

              <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-sm font-semibold">Lead Intake Webhook</p>
                <p className="text-xs text-slate-500">Simulates POST /api/webhooks/leads with round-robin assignment and call bridge.</p>
                <button
                  onClick={createWebhookLead}
                  className="h-11 w-full rounded-xl border border-indigo-600 text-sm font-semibold text-indigo-600"
                >
                  Trigger sample webhook
                </button>
                <div className="rounded-xl bg-slate-100 p-3 text-xs text-slate-700">
                  <p>Mode: {state.integrationSettings.mode}</p>
                  <p>Assignment: {state.integrationSettings.leadAssignmentMode}</p>
                </div>
                <p className="text-sm font-semibold">Recent activity</p>
                <div className="max-h-48 space-y-2 overflow-auto">
                  {state.activities.slice(0, 8).map((activity) => (
                    <div key={activity.id} className="rounded-xl border border-slate-100 bg-slate-50 p-2 text-xs">
                      <p className="font-medium text-slate-800">{activity.content}</p>
                      <p className="text-slate-500">{formatTime(activity.createdAt)}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}

        {activeTab === "Leads" && (
          <section className="space-y-3">
            <div className="flex gap-2">
              <TextInput placeholder="Search leads" value={leadSearch} onChange={(event) => setLeadSearch(event.target.value)} />
              <SelectInput value={leadFilterStatus} onChange={(event) => setLeadFilterStatus(event.target.value)}>
                <option>All</option>
                {leadStatuses.map((status) => (
                  <option key={status}>{status}</option>
                ))}
              </SelectInput>
            </div>
            <div className="space-y-2">
              {filteredLeads.map((lead) => (
                <motion.button
                  key={lead.id}
                  whileTap={{ scale: 0.99 }}
                  onClick={() => setSelectedLeadId(lead.id)}
                  className="w-full rounded-2xl border border-slate-200 bg-white p-3 text-left"
                >
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-slate-900">{lead.fullName}</p>
                    <Badge text={lead.temperature} />
                  </div>
                  <p className="text-sm text-slate-600">{lead.phone}</p>
                  <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                    <span>{lead.source}</span>
                    <span>{lead.status}</span>
                  </div>
                </motion.button>
              ))}
              {!filteredLeads.length && <p className="rounded-xl bg-white p-4 text-sm text-slate-500">No leads found for filters.</p>}
            </div>
          </section>
        )}

        {activeTab === "Properties" && (
          <section className="space-y-3">
            <TextInput placeholder="Search inventory" value={propertyFilter} onChange={(event) => setPropertyFilter(event.target.value)} />
            <div className="space-y-2">
              {filteredProperties.map((property) => (
                <div key={property.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                  <p className="font-semibold">{property.title}</p>
                  <p className="text-sm text-slate-600">{property.location}</p>
                  <div className="mt-2 flex justify-between text-xs text-slate-500">
                    <span>INR {property.price.toLocaleString("en-IN")}</span>
                    <span>{property.availabilityStatus}</span>
                  </div>
                </div>
              ))}
            </div>
            <form
              className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4"
              onSubmit={(event) => {
                event.preventDefault();
                createProperty(new FormData(event.currentTarget));
                event.currentTarget.reset();
              }}
            >
              <p className="text-sm font-semibold">Add property</p>
              <TextInput name="title" placeholder="Title" required />
              <div className="grid grid-cols-2 gap-2">
                <TextInput name="location" placeholder="Location" required />
                <TextInput name="address" placeholder="Address" required />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <SelectInput name="propertyType">
                  <option>Apartment</option>
                  <option>Villa</option>
                  <option>Plot</option>
                  <option>Commercial</option>
                  <option>Rental</option>
                </SelectInput>
                <TextInput name="price" type="number" placeholder="Price" required />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <TextInput name="size" placeholder="Size" required />
                <TextInput name="bedrooms" type="number" placeholder="Beds" required />
                <TextInput name="bathrooms" type="number" placeholder="Baths" required />
              </div>
              <TextInput name="floor" placeholder="Floor" required />
              <div className="grid grid-cols-2 gap-2">
                <TextInput name="furnishingStatus" placeholder="Furnishing" required />
                <SelectInput name="availabilityStatus">
                  <option>Available</option>
                  <option>Hold</option>
                  <option>Sold</option>
                  <option>Rented</option>
                </SelectInput>
              </div>
              <TextInput name="description" placeholder="Description" required />
              <button className="h-11 w-full rounded-xl bg-slate-900 text-sm font-semibold text-white">Add listing</button>
            </form>
          </section>
        )}

        {activeTab === "Follow-ups" && (
          <section className="space-y-3">
            <form
              className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4"
              onSubmit={(event) => {
                event.preventDefault();
                addFollowup(new FormData(event.currentTarget));
                event.currentTarget.reset();
              }}
            >
              <p className="text-sm font-semibold">Schedule follow-up</p>
              <SelectInput name="leadId">
                {state.leads.slice(0, 20).map((lead) => (
                  <option key={lead.id} value={lead.id}>
                    {lead.fullName}
                  </option>
                ))}
              </SelectInput>
              <SelectInput name="channel">
                <option>WhatsApp</option>
                <option>SMS</option>
                <option>Email</option>
                <option>Call Reminder</option>
              </SelectInput>
              <SelectInput name="template" defaultValue={followupTemplates[0]}>
                {followupTemplates.map((template) => (
                  <option key={template}>{template}</option>
                ))}
              </SelectInput>
              <TextInput name="dueAt" type="datetime-local" required />
              <button className="h-11 w-full rounded-xl bg-indigo-600 text-sm font-semibold text-white">Schedule</button>
            </form>

            <div className="space-y-2">
              {state.followups.map((followup) => {
                const lead = state.leads.find((entry) => entry.id === followup.leadId);
                return (
                  <div key={followup.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold">{lead?.fullName ?? "Unknown lead"}</p>
                      <Badge text={followup.status} />
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{followup.channel} • {formatTime(followup.dueAt)}</p>
                    <div className="mt-2 flex gap-2">
                      <button
                        className="h-9 flex-1 rounded-xl border border-slate-300 text-xs"
                        onClick={() => {
                          setState((prev) => ({
                            ...prev,
                            followups: prev.followups.map((entry) =>
                              entry.id === followup.id ? { ...entry, status: "Completed", updatedAt: nowIso() } : entry
                            ),
                          }));
                        }}
                      >
                        Complete
                      </button>
                      <button
                        className="h-9 flex-1 rounded-xl border border-slate-300 text-xs"
                        onClick={() => {
                          setState((prev) => ({
                            ...prev,
                            followups: prev.followups.map((entry) =>
                              entry.id === followup.id
                                ? {
                                    ...entry,
                                    status: "Snoozed",
                                    dueAt: new Date(Date.now() + 1000 * 60 * 60 * 4).toISOString(),
                                    updatedAt: nowIso(),
                                  }
                                : entry
                            ),
                          }));
                        }}
                      >
                        Snooze 4h
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {activeTab === "More" && (
          <section className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {moreTabs.map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveMoreTab(tab)}
                  className={`rounded-full px-3 py-2 text-xs font-semibold ${
                    tab === activeMoreTab ? "bg-indigo-600 text-white" : "bg-white text-slate-700"
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            {activeMoreTab === "Attendance" && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => runAttendance("in")} className="h-11 rounded-xl bg-emerald-600 text-sm font-semibold text-white">
                    Check in
                  </button>
                  <button onClick={() => runAttendance("out")} className="h-11 rounded-xl border border-slate-300 text-sm font-semibold">
                    Check out
                  </button>
                </div>
                {state.attendance.slice(0, 8).map((entry) => {
                  const user = state.profiles.find((profile) => profile.id === entry.userId);
                  return (
                    <div key={entry.id} className="rounded-2xl border border-slate-200 bg-white p-3 text-sm">
                      <p className="font-semibold">{user?.fullName}</p>
                      <p className="text-xs text-slate-500">In: {formatTime(entry.checkInTime)}</p>
                      <p className="text-xs text-slate-500">Out: {formatTime(entry.checkOutTime)}</p>
                    </div>
                  );
                })}
              </div>
            )}

            {activeMoreTab === "Social Media" && (
              <div className="space-y-2">
                <form
                  className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    createPost(new FormData(event.currentTarget));
                    event.currentTarget.reset();
                  }}
                >
                  <p className="text-sm font-semibold">Create post</p>
                  <SelectInput name="type">
                    <option>Instagram Reel</option>
                    <option>Instagram Post</option>
                    <option>Facebook Post</option>
                    <option>LinkedIn Post</option>
                    <option>Story</option>
                  </SelectInput>
                  <TextInput name="caption" placeholder="Caption" />
                  <TextInput name="mediaUrl" placeholder="Media URL" />
                  <SelectInput name="status">
                    <option>Idea</option>
                    <option>Draft</option>
                    <option>Scheduled</option>
                    <option>Published</option>
                  </SelectInput>
                  <TextInput name="scheduledAt" type="datetime-local" />
                  <SelectInput name="assignedTo">
                    {state.profiles.map((profile) => (
                      <option value={profile.id} key={profile.id}>
                        {profile.fullName}
                      </option>
                    ))}
                  </SelectInput>
                  <TextInput name="notes" placeholder="Notes" />
                  <button className="h-11 w-full rounded-xl bg-slate-900 text-white">Save post</button>
                </form>
                {state.socialPosts.slice(0, 8).map((post) => (
                  <div key={post.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold">{post.type}</p>
                      <Badge text={post.status} />
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{post.caption}</p>
                  </div>
                ))}
              </div>
            )}

            {activeMoreTab === "Team" && (
              <div className="space-y-2">
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    inviteMember(new FormData(event.currentTarget));
                    event.currentTarget.reset();
                  }}
                  className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4"
                >
                  <p className="text-sm font-semibold">Invite member</p>
                  <TextInput name="fullName" placeholder="Name" required />
                  <TextInput name="email" placeholder="Email" required />
                  <SelectInput name="role">
                    <option value="sales_agent">Sales Agent</option>
                    <option value="sales_manager">Sales Manager</option>
                    <option value="field_executive">Field Executive</option>
                    <option value="social_media_manager">Social Media Manager</option>
                  </SelectInput>
                  <button className="h-11 w-full rounded-xl bg-indigo-600 text-white">Invite</button>
                </form>
                {state.profiles.map((profile) => (
                  <div key={profile.id} className="rounded-2xl border border-slate-200 bg-white p-3 text-sm">
                    <p className="font-semibold">{profile.fullName}</p>
                    <p className="text-xs text-slate-500">{profile.role} • {profile.email}</p>
                  </div>
                ))}
              </div>
            )}

            {(activeMoreTab === "Settings" || activeMoreTab === "Integrations") && (
              <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4 text-sm">
                <p className="font-semibold">Integration settings</p>
                <SelectInput
                  value={state.integrationSettings.mode}
                  onChange={(event) =>
                    setState((prev) => ({
                      ...prev,
                      integrationSettings: {
                        ...prev.integrationSettings,
                        mode: event.target.value as "dry-run" | "production",
                      },
                    }))
                  }
                >
                  <option value="dry-run">dry-run</option>
                  <option value="production">production</option>
                </SelectInput>
                <SelectInput
                  value={state.integrationSettings.leadAssignmentMode}
                  onChange={(event) =>
                    setState((prev) => ({
                      ...prev,
                      integrationSettings: {
                        ...prev.integrationSettings,
                        leadAssignmentMode: event.target.value as CRMState["integrationSettings"]["leadAssignmentMode"],
                      },
                    }))
                  }
                >
                  <option>Round Robin</option>
                  <option>Manual</option>
                  <option>Least Busy Agent</option>
                </SelectInput>
                <TextInput placeholder="Twilio Account SID" value={state.integrationSettings.twilioAccountSid} readOnly />
                <p className="text-xs text-slate-500">Secrets are intended for env vars in production deployment.</p>
              </div>
            )}

            {activeMoreTab === "Reports" && (
              <div className="space-y-2">
                <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
                  <p className="font-semibold">Leads by source</p>
                  {Array.from(new Set(state.leads.map((lead) => lead.source))).map((source) => (
                    <p key={source} className="text-xs text-slate-600">
                      {source}: {state.leads.filter((lead) => lead.source === source).length}
                    </p>
                  ))}
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
                  <p className="font-semibold">Won/Lost</p>
                  <p className="text-xs text-slate-600">Won: {state.leads.filter((lead) => lead.status === "Won").length}</p>
                  <p className="text-xs text-slate-600">Lost: {state.leads.filter((lead) => lead.status === "Lost").length}</p>
                  <p className="text-xs text-slate-600">Properties shared: {state.messages.filter((m) => m.templateName === "property_share").length}</p>
                </div>
              </div>
            )}
          </section>
        )}
      </main>

      <AnimatePresence>
        {selectedLead && (
          <motion.aside
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 24, stiffness: 250 }}
            className="fixed inset-x-0 bottom-16 z-30 max-h-[70vh] overflow-auto rounded-t-3xl border border-slate-200 bg-white p-4"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-lg font-semibold">{selectedLead.fullName}</p>
                <p className="text-xs text-slate-500">{selectedLead.phone} • {selectedLead.preferredLocation}</p>
              </div>
              <button onClick={() => setSelectedLeadId(null)} className="rounded-full bg-slate-100 px-3 py-1 text-sm">
                Close
              </button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button onClick={() => handleQuickCall(selectedLead)} className="h-11 rounded-xl bg-emerald-600 text-sm font-semibold text-white">
                Call now
              </button>
              <button onClick={() => shareFirstMatchedProperty(selectedLead)} className="h-11 rounded-xl bg-indigo-600 text-sm font-semibold text-white">
                Share property
              </button>
              <button
                onClick={() => sendQuickFollowup(selectedLead, "WhatsApp")}
                className="h-11 rounded-xl border border-slate-300 text-sm font-semibold"
              >
                WhatsApp
              </button>
              <button
                onClick={() => sendQuickFollowup(selectedLead, "SMS")}
                className="h-11 rounded-xl border border-slate-300 text-sm font-semibold"
              >
                SMS
              </button>
            </div>
            <div className="mt-3">
              <SelectInput
                value={selectedLead.status}
                onChange={(event) => {
                  const nextStatus = event.target.value as LeadStatus;
                  updateLead(selectedLead.id, (lead) => ({ ...lead, status: nextStatus }));
                  addActivity(selectedLead.id, "status_change", `Status changed to ${nextStatus}`);
                }}
              >
                {leadStatuses.map((status) => (
                  <option key={status}>{status}</option>
                ))}
              </SelectInput>
            </div>

            <div className="mt-4 space-y-2">
              <p className="text-sm font-semibold">Recommended properties</p>
              {state.properties
                .filter(
                  (property) =>
                    property.propertyType === selectedLead.propertyType &&
                    property.price >= selectedLead.budgetMin &&
                    property.price <= selectedLead.budgetMax
                )
                .slice(0, 3)
                .map((property) => (
                  <div key={property.id} className="rounded-xl border border-slate-200 p-2 text-xs">
                    <p className="font-semibold">{property.title}</p>
                    <p>{property.location}</p>
                  </div>
                ))}
            </div>

            <div className="mt-4 space-y-2">
              <p className="text-sm font-semibold">Timeline</p>
              {state.activities
                .filter((activity) => activity.leadId === selectedLead.id)
                .slice(0, 8)
                .map((activity) => (
                  <div key={activity.id} className="rounded-xl border border-slate-200 p-2 text-xs">
                    <p className="font-medium">{activity.content}</p>
                    <p className="text-slate-500">{formatTime(activity.createdAt)}</p>
                  </div>
                ))}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white">
        <div className="mx-auto grid max-w-5xl grid-cols-5">
          {mainTabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`h-14 text-xs font-semibold ${activeTab === tab ? "text-indigo-600" : "text-slate-500"}`}
            >
              {tab}
            </button>
          ))}
        </div>
      </nav>

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed left-1/2 top-20 z-50 w-[90%] max-w-md -translate-x-1/2 rounded-xl bg-slate-900 px-4 py-2 text-sm text-white"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
