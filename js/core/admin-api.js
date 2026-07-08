import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";

const { functions } = window.__firebase;

const createEmployeesCallable = httpsCallable(functions, "createEmployeeAccounts");
const createManagedAccountCallable = httpsCallable(functions, "createManagedAccount");
const deleteEmployeeCallable = httpsCallable(functions, "deleteEmployeeAccount");
const deleteManagedAccountCallable = httpsCallable(functions, "deleteManagedAccount");

export async function createEmployeeAccounts(payload) {
  const result = await createEmployeesCallable(payload);
  return result.data;
}

export async function createManagedAccount(payload) {
  const result = await createManagedAccountCallable(payload);
  return result.data;
}

export async function deleteEmployeeAccount(payload) {
  const result = await deleteEmployeeCallable(payload);
  return result.data;
}

export async function deleteManagedAccount(payload) {
  const result = await deleteManagedAccountCallable(payload);
  return result.data;
}
