// hris-client.mjs
import fetchCookie from "fetch-cookie";
import fetchOrig from "node-fetch";
import { CookieJar } from "tough-cookie";

const BASE = "https://hris.kantorku.id";
const sejutacitaApi = "https://api.sejutacita.id";

const jar = new CookieJar();
const fetch = fetchCookie(fetchOrig, jar);

function extractCookieFromSetCookieArray(setCookieArray, cookieName) {
	if (!setCookieArray) return null;
	for (const cookieStr of setCookieArray) {
		const match = cookieStr.match(new RegExp(`(?:^|; )${cookieName}=([^;]+)`));
		if (match) return match[1];
	}
	return null;
}

export async function getCsrf() {
	const res = await fetch(`${BASE}/api/auth/csrf`, {
		method: "GET",
		headers: { accept: "*/*", "content-type": "application/json" },
		redirect: "manual",
	});

	if (!(res.ok || res.status === 200)) {
		throw new Error(`csrf failed ${res.status}`);
	}

	const body = await res.json();
	if (!body || !body.csrfToken)
		throw new Error("csrf token missing in response");
	return body.csrfToken;
}

export async function login(email, password) {
	const csrf = await getCsrf();

	const form = new URLSearchParams({
		email,
		password,
		redirect: "false",
		platform: "hris_employer_web",
		type: "email",
		csrfToken: csrf,
		json: "true",
	});

	const loginRes = await fetch(`${BASE}/api/auth/callback/credentials`, {
		method: "POST",
		headers: {
			"content-type": "application/x-www-form-urlencoded",
			origin: BASE,
			accept: "*/*",
		},
		body: form.toString(),
		redirect: "manual",
	});

	const raw =
		typeof loginRes.headers.raw === "function"
			? loginRes.headers.raw()
			: undefined;
	const setCookie = raw?.["set-cookie"];

	let sessionToken =
		extractCookieFromSetCookieArray(
			setCookie,
			"__Secure-next-auth.session-token"
		) ?? extractCookieFromSetCookieArray(setCookie, "next-auth.session-token");

	if (!sessionToken && loginRes.status >= 300 && loginRes.status < 400) {
		const loc = loginRes.headers.get("location");
		if (loc) {
			await fetch(loc, { method: "GET", redirect: "manual" });
		}
	}

	const sessRes = await fetch(`${BASE}/api/auth/session`, {
		method: "GET",
		headers: { accept: "application/json" },
		redirect: "manual",
	});

	let sessJson = null;
	try {
		sessJson = await sessRes.json();
	} catch (e) {
		sessJson = null;
	}

	if (!sessionToken) {
		const raw2 =
			typeof sessRes.headers.raw === "function"
				? sessRes.headers.raw()
				: undefined;
		const setCookie2 = raw2?.["set-cookie"];
		sessionToken =
			extractCookieFromSetCookieArray(
				setCookie2,
				"__Secure-next-auth.session-token"
			) ??
			extractCookieFromSetCookieArray(setCookie2, "next-auth.session-token");
	}

	if (!sessJson) {
		const text = await loginRes.text().catch(() => "<unreadable>");
		throw new Error(
			`Login appears to have failed. status=${loginRes.status} body=${text}`
		);
	}

	return {
		sessJson,
		sessionToken: sessionToken ?? "",
	};
}

export async function getCompanyUnit(companyId, token) {
	const url = `${sejutacitaApi}/v2/hris/company-unit/list?company_id_eq=${encodeURIComponent(
		companyId
	)}`;
	const res = await fetch(url, {
		method: "GET",
		headers: {
			accept: "*/*",
			"content-type": "application/json",
			authorization: "Bearer " + token,
		},
	});

	if (!(res.ok || res.status === 200)) {
		throw new Error("Get Company Unit failed " + res.status);
	}
	return await res.json();
}

export async function createCompanyUnit(payload, token) {
	const bodyArray = Array.isArray(payload) ? payload : [payload];

	const res = await fetch(`${sejutacitaApi}/v2/hris/company-unit/list`, {
		method: "POST",
		headers: {
			accept: "*/*",
			"content-type": "application/json",
			authorization: "Bearer " + token,
		},
		body: JSON.stringify(bodyArray),
	});

	const text = await res.text();
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		parsed = text;
	}

	if (!res.ok)
		throw new Error(`Create Company Unit failed (${res.status}) : ${text}`);
	return parsed;
}

export async function createCompanyUnitItem(payload, token) {
	const bodyArray = Array.isArray(payload) ? payload : [payload];

	const res = await fetch(`${sejutacitaApi}/v2/hris/company-unit-item/list`, {
		method: "POST",
		headers: {
			accept: "*/*",
			"content-type": "application/json",
			authorization: "Bearer " + token,
		},
		body: JSON.stringify(bodyArray),
	});

	const text = await res.text();
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		parsed = text;
	}

	if (!res.ok)
		throw new Error(
			`Create Company Unit Item failed (${res.status}) : ${text}`
		);
	return parsed;
}

async function ensureCompanyUnitExists(companyId, name, token, docs) {
	const lcName = name.toLowerCase();
	let found = (docs ?? []).find((v) => (v.name ?? "").toLowerCase() === lcName);
	if (found) {
		console.log(`[INFO] Unit "${name}" ditemukan (id=${found.id}).`);
		return found;
	}

	console.log(`[STEP] Unit "${name}" tidak ditemukan — membuat...`);
	const payload = [
		{
			companyId,
			deletable: true,
			name,
			label: name,
			order: (docs?.length ?? 0) + 1,
		},
	];

	const res = await createCompanyUnit(payload, token);
	const createdDocs = res?.data?.docs ?? res?.docs ?? [];
	found = createdDocs.find((v) => (v.name ?? "").toLowerCase() === lcName);
	if (!found) {
		throw new Error(
			`[FAIL] Gagal membuat company unit "${name}". Response: ${JSON.stringify(
				res
			)}`
		);
	}
	console.log(`[PASS] Unit "${name}" berhasil dibuat (id=${found.id}).`);
	return found;
}

function generateValues(prefix, count, start = 1) {
	return Array.from({ length: count }, (_, i) => ({
		value: `${prefix} ${i + start}`,
	}));
}

(async () => {
	console.log("[RUN] Mulai automation script - Company Unit & Items");

	try {
		console.log("[STEP 1] Mencoba login...");
		const email = "drop@drop.rasyidridho.biz.id";
		const password = "Testing21";
		if (!email || !password)
			throw new Error("Email dan password harus diisis!");

		const out = await login(email, password);
		if (!out?.sessJson) throw new Error("Login gagal: session JSON kosong");
		console.log("[PASS] Login sukses.");

		const companyId =
			out.sessJson?.user?.companyId ?? out.sessJson?.user?.company?.id ?? "";
		if (!companyId) {
			console.warn(
				"[WARN] companyId tidak ditemukan di session. Harap sediakan companyId secara eksplisit."
			);
			throw new Error("companyId missing - aborting.");
		}
		console.log(`[INFO] companyId: ${companyId}`);

		console.log("[STEP 2] Ambil daftar company unit eksisting...");
		const companyUnitList = await getCompanyUnit(companyId, out.sessionToken);
		const docs = companyUnitList?.data?.docs ?? [];
		console.log(`[INFO] Ditemukan ${docs.length} company unit.`);

		console.log("[STEP 3] Pastikan unit: Position, Area, Sub Area");
		const position = await ensureCompanyUnitExists(
			companyId,
			"Position",
			out.sessionToken,
			docs
		);
		const area = await ensureCompanyUnitExists(
			companyId,
			"Area",
			out.sessionToken,
			docs
		);
		const subArea = await ensureCompanyUnitExists(
			companyId,
			"Sub Area",
			out.sessionToken,
			docs
		);

		console.log("[STEP 4] Generate dan buat items untuk setiap unit");

		// buat 10 position items
		const positionItems = generateValues("Backend Developer", 10, 1).map(
			(x) => ({ ...x, companyUnitId: position.id })
		);
		console.log(
			`[INFO] Membuat ${positionItems.length} item untuk Position (id=${position.id})`
		);
		const posResp = await createCompanyUnitItem(
			positionItems,
			out.sessionToken
		);
		console.log(
			"[PASS] Position items create response:",
			JSON.stringify(posResp).slice(0, 500)
		);

		// generate 20 Area
		const areaItems = generateValues("Yogakarta", 20, 1).map((x) => ({
			...x,
			companyUnitId: area.id,
		}));

		// generate 20 Sub Area
		const subAreaItems = generateValues("Bantul", 20, 1).map((x) => ({
			...x,
			companyUnitId: subArea.id,
		}));
		const combined = areaItems.concat(subAreaItems);
		console.log(`[INFO] Membuat ${combined.length} item untuk Area & Sub Area`);
		const areaResp = await createCompanyUnitItem(combined, out.sessionToken);
		console.log(
			"[PASS] Area/Sub Area items create response:",
			JSON.stringify(areaResp).slice(0, 500)
		);

		console.log("[DONE] Semua langkah selesai tanpa error.");
	} catch (err) {
		console.error("[ERROR]", err?.message ?? err);
		process.exitCode = 1;
	}
})();
